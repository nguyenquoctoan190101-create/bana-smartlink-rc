from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

from services.chatbot import (
    _QueryIntent,
    _classify_question_with_gemini,
    _build_gemini_prompt,
    _query_village_indicator,
    _redact_free_text,
    ask_question_async,
)


class _StructuredGemini:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.user_text = ""

    async def generate_json(
        self,
        system_prompt: str,
        user_text: str,
        response_schema: dict[str, Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        _ = (system_prompt, response_schema, kwargs)
        self.user_text = user_text
        return self.result


class _CaptureConnection:
    def __init__(self) -> None:
        self.sql = ""
        self.params: tuple[Any, ...] = ()

    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.sql = sql
        self.params = params
        return []


class _DataConnection(_CaptureConnection):
    async def fetch(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        self.sql = sql
        self.params = params
        return [
            {
                "village_name": "Thôn Sơn Phước",
                "period_name": "Bản công bố minh họa — Tháng 7/2026",
                "ct_code": "CT09",
                "value": 479,
                "status": "approved",
            }
        ]

    async def close(self) -> None:
        return None


class _TextGemini:
    async def generate_text(self, *args: Any, **kwargs: Any) -> str:
        _ = (args, kwargs)
        return "Thôn Sơn Phước có 479 gia đình văn hóa."


def test_free_text_redaction_covers_common_identifiers() -> None:
    redacted = _redact_free_text(
        "Liên hệ 0901234567, a.nguyen@example.com, CCCD 012345678901"
    )

    assert "0901234567" not in redacted
    assert "a.nguyen@example.com" not in redacted
    assert "012345678901" not in redacted
    assert "[PHONE_REDACTED]" in redacted
    assert "[EMAIL_REDACTED]" in redacted
    assert "[ID_REDACTED]" in redacted


def test_gemini_nlu_is_structured_allowlisted_and_history_is_redacted() -> None:
    fake = _StructuredGemini(
        {
            "intent": "VILLAGE_INDICATOR",
            "ct_code": "CT09",
            "village_names": ["Sơn Phước", "Thôn không tồn tại"],
            "period_name": "tháng 7/2026",
        }
    )

    with patch("services.chatbot.get_gemini_client", return_value=fake):
        parsed = asyncio.run(
            _classify_question_with_gemini(
                "Còn số gia đình đạt chuẩn thì sao?",
                [
                    {"role": "user", "content": "Tôi ở Sơn Phước, 0901234567"},
                    {"role": "assistant", "content": "Bạn muốn xem chỉ tiêu nào?"},
                ],
            )
        )

    assert parsed is not None
    assert parsed.intent == _QueryIntent.VILLAGE_INDICATOR
    assert parsed.ct_code == "CT09"
    assert parsed.village_names == ["Thôn Sơn Phước"]
    assert parsed.period_name == "tháng 7/2026"
    assert "0901234567" not in fake.user_text
    assert "[PHONE_REDACTED]" in fake.user_text


def test_out_of_scope_question_gets_a_reasonable_boundary_response() -> None:
    fake = _StructuredGemini(
        {
            "intent": "OUT_OF_SCOPE",
            "ct_code": "NONE",
            "village_names": [],
            "period_name": "",
        }
    )

    with patch("services.chatbot.get_gemini_client", return_value=fake):
        answer = asyncio.run(
            ask_question_async("Ngày mai trời có mưa không?", caller_role="dan")
        )

    assert answer.intent == "OUT_OF_SCOPE"
    assert answer.rows_retrieved == 0
    assert "ngoài phạm vi" in answer.answer
    assert "không dùng kiến thức bên ngoài" in answer.answer


def test_obvious_out_of_scope_question_is_explained_without_model_fallback() -> None:
    answer = asyncio.run(ask_question_async("Ngày mai thời tiết có mưa không?", caller_role="dan"))

    assert answer.intent == "OUT_OF_SCOPE"
    assert answer.rows_retrieved == 0
    assert "ngoài phạm vi" in answer.answer


def test_pending_legacy_village_mapping_fails_closed() -> None:
    answer = asyncio.run(
        ask_question_async("Thôn Đông Sơn có bao nhiêu hộ dân?", caller_role="dan")
    )

    assert answer.intent == "PENDING_VILLAGE_MAPPING"
    assert answer.rows_retrieved == 0
    assert "chưa có quyết định" in answer.answer


def test_screenshot_question_reaches_ct09_database_query() -> None:
    connection = _DataConnection()
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
        answer = asyncio.run(
            ask_question_async(
                "Thôn Sơn Phước có bao nhiêu gia đình văn hóa?",
                caller_role="dan",
            )
        )

    assert answer.intent == "VILLAGE_INDICATOR"
    assert answer.rows_retrieved == 1
    assert "479" in answer.answer
    assert "CT09" in connection.params


def test_answer_prompt_explains_legacy_name_resolution() -> None:
    prompt = _build_gemini_prompt(
        "Thôn Mỹ Sơn có bao nhiêu hộ dân?",
        [
            {
                "village_name": "Thôn Sơn Phước",
                "period_name": "Tháng 7/2026",
                "ct_code": "CT01",
                "value": 181,
                "status": "approved",
            }
        ],
        ["Thôn Sơn Phước"],
    )

    assert "ten_thon_chuan_hoa" in prompt
    assert "Thôn Sơn Phước" in prompt
    assert "tên thôn cũ" in prompt


def test_cnscd_query_is_scoped_by_assignment_not_single_profile_village() -> None:
    connection = _CaptureConnection()
    user_id = "11111111-1111-4111-8111-111111111111"

    rows = asyncio.run(
        _query_village_indicator(
            connection,  # type: ignore[arg-type]
            village_names=[],
            ct_code="CT01",
            period_name=None,
            xa_id=None,
            caller_role="to_cnscd",
            caller_user_id=user_id,
        )
    )

    assert rows == []
    assert "user_village_assignments" in connection.sql
    assert user_id in connection.params


def test_cnscd_without_assignment_identity_fails_closed() -> None:
    connection = _CaptureConnection()

    rows = asyncio.run(
        _query_village_indicator(
            connection,  # type: ignore[arg-type]
            village_names=[],
            ct_code="CT01",
            period_name=None,
            xa_id=None,
            caller_role="to_cnscd",
            caller_user_id=None,
        )
    )

    assert rows == []
    assert connection.sql == ""
