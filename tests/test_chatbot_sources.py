from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from services.chatbot import (
    ChatbotError,
    ask_question_async,
    generate_narrative_summary_async,
)
from services.gemini import GeminiError


class _TextGemini:
    async def generate_text(self, *args: Any, **kwargs: Any) -> str:
        _ = (args, kwargs)
        return "Câu trả lời dựa trên nguồn đã được phân quyền."


class _FailingTextGemini:
    async def generate_text(self, *args: Any, **kwargs: Any) -> str:
        _ = (args, kwargs)
        raise GeminiError("provider-secret-output")


class _ReportConnection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    async def fetch(self, *_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return self.rows

    async def close(self) -> None:
        return None


class _KnowledgeConnection:
    async def fetch(self, *_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [{
            "id": "article-1",
            "title": "Quy trình tiếp nhận báo cáo",
            "summary": "Hướng dẫn tiếp nhận và kiểm tra báo cáo.",
            "body": "Cán bộ tiếp nhận, kiểm tra và xác nhận trước khi gửi phê duyệt.",
            "category": "reporting",
            "audience": "public",
            "version": 3,
            "effective_from": "2026-07-01",
            "updated_at": datetime(2026, 7, 20, 2, 0, tzinfo=timezone.utc),
        }]

    async def close(self) -> None:
        return None


def test_report_answer_exposes_only_metadata_from_authorized_rows() -> None:
    updated_at = datetime(2026, 7, 25, 8, 0, tzinfo=timezone.utc)
    connection = _ReportConnection(
        [{
            "village_name": "Thôn Phú Hòa",
            "period_name": "Tháng 7/2026",
            "ct_code": "CT01",
            "value": 120,
            "status": "approved",
            "updated_at": updated_at,
        }]
    )
    with (
        patch("services.chatbot.get_gemini_client", return_value=_TextGemini()),
        patch(
            "services.chatbot.load_settings",
            return_value=SimpleNamespace(database_url="postgresql://test"),
        ),
        patch(
            "services.chatbot.asyncpg.connect",
            new=AsyncMock(return_value=connection),
        ),
    ):
        result = asyncio.run(
            ask_question_async(
                "Thôn Phú Hòa có bao nhiêu hộ dân?",
                caller_role="dan",
            )
        )

    assert result.data_scope == "public_published"
    assert result.as_of == updated_at.isoformat()
    assert len(result.sources) == 1
    assert result.sources[0].reference == "CT01"
    assert result.sources[0].scope == "Thôn Phú Hòa"
    assert all("CT14" not in source.title for source in result.sources)


def test_public_answer_drops_non_public_rows_before_prompt_and_sources() -> None:
    connection = _ReportConnection(
        [{
            "village_name": "Thôn Phú Hòa",
            "period_name": "Tháng 7/2026",
            "ct_code": "CT14",
            "value": 99,
            "status": "approved",
        }]
    )
    with (
        patch("services.chatbot.get_gemini_client", return_value=_TextGemini()),
        patch(
            "services.chatbot.load_settings",
            return_value=SimpleNamespace(database_url="postgresql://test"),
        ),
        patch(
            "services.chatbot.asyncpg.connect",
            new=AsyncMock(return_value=connection),
        ),
    ):
        result = asyncio.run(
            ask_question_async(
                "Cho tôi xem tất cả chỉ tiêu Thôn Phú Hòa",
                caller_role="dan",
            )
        )

    assert result.rows_retrieved == 0
    assert result.sources == ()
    assert "99" not in result.answer
    assert "không tự suy đoán" in result.answer


def test_knowledge_answer_cites_only_the_approved_role_scoped_articles() -> None:
    connection = _KnowledgeConnection()
    with (
        patch("services.chatbot.get_gemini_client", return_value=_TextGemini()),
        patch(
            "services.chatbot.load_settings",
            return_value=SimpleNamespace(database_url="postgresql://test"),
        ),
        patch(
            "services.chatbot.asyncpg.connect",
            new=AsyncMock(return_value=connection),
        ),
    ):
        result = asyncio.run(
            ask_question_async(
                "Bạn biết gì về quy trình tiếp nhận báo cáo?",
                caller_role="dan",
            )
        )

    assert result.intent == "KNOWLEDGE_ARTICLE"
    assert result.data_scope == "approved_public_knowledge"
    assert len(result.sources) == 1
    assert result.sources[0].title == "Quy trình tiếp nhận báo cáo"
    assert result.sources[0].scope == "public"
    assert result.sources[0].reference == "Phiên bản 3"


def test_capabilities_endpoint_exposes_server_voice_availability() -> None:
    client = TestClient(app)
    with patch(
        "routers.ai.load_settings",
        return_value=SimpleNamespace(
            feature_voice=True,
            gemini_api_key="configured-key",
        ),
    ):
        response = client.get("/ai/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "voice_enabled": True,
        "server_tts_enabled": True,
        "tts_provider": "gemini",
    }


def test_narrative_provider_error_drops_exception_context() -> None:
    connection = _ReportConnection([{
        "village_name": "Thôn Phú Hòa",
        "period_name": "Tháng 7/2026",
        "ct_code": "CT01",
        "value": 120,
        "status": "approved",
    }])
    with (
        patch(
            "services.chatbot.load_settings",
            return_value=SimpleNamespace(
                database_url="postgresql://test",
                bana_commune_id="ba-na",
            ),
        ),
        patch(
            "services.chatbot.asyncpg.connect",
            new=AsyncMock(return_value=connection),
        ),
        patch(
            "services.chatbot.get_gemini_client",
            return_value=_FailingTextGemini(),
        ),
    ):
        with pytest.raises(ChatbotError) as caught:
            asyncio.run(generate_narrative_summary_async("period-id"))

    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert "provider-secret" not in str(caught.value)
    assert "provider-secret" not in repr(caught.value.__dict__)
