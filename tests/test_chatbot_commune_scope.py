from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import create_app
from routers.auth import get_optional_user
from services.chatbot import ChatbotAnswer
from services.supabase_admin import UserProfile


def _answer(question: str) -> ChatbotAnswer:
    return ChatbotAnswer(
        question=question,
        answer="Không có dữ liệu ngoài phạm vi được phân quyền.",
        intent="UNKNOWN",
        rows_retrieved=0,
    )


def test_public_chat_is_always_scoped_to_configured_commune() -> None:
    app = create_app()
    chatbot = AsyncMock(side_effect=lambda question, **_: _answer(question))
    with (
        patch(
            "routers.ai.load_settings",
            return_value=SimpleNamespace(bana_commune_id="ba_na"),
        ),
        patch("routers.ai.ask_question_async", chatbot),
        TestClient(app) as client,
    ):
        response = client.post("/ai/chat", json={"question": "Có bao nhiêu hộ dân?"})

    assert response.status_code == 200, response.text
    assert chatbot.await_args.kwargs["xa_id"] == "ba_na"
    assert chatbot.await_args.kwargs["caller_role"] == "dan"


def test_public_chat_rejects_client_requested_other_commune() -> None:
    app = create_app()
    chatbot = AsyncMock(side_effect=AssertionError("query must not run"))
    with (
        patch(
            "routers.ai.load_settings",
            return_value=SimpleNamespace(bana_commune_id="ba_na"),
        ),
        patch("routers.ai.ask_question_async", chatbot),
        TestClient(app) as client,
    ):
        response = client.post(
            "/ai/chat",
            json={"question": "Có bao nhiêu hộ dân?", "xa_id": "other_commune"},
        )

    assert response.status_code == 403, response.text
    assert chatbot.await_count == 0


def test_authenticated_chat_uses_profile_commune_and_rejects_mismatch() -> None:
    app = create_app()
    app.dependency_overrides[get_optional_user] = lambda: UserProfile(
        id="11111111-1111-4111-8111-111111111111",
        role="admin_xa",
        village_id=None,
        force_password_reset=False,
        commune_id="commune_a",
    )
    chatbot = AsyncMock(side_effect=lambda question, **_: _answer(question))
    try:
        with (
            patch(
                "routers.ai.load_settings",
                return_value=SimpleNamespace(bana_commune_id="ba_na"),
            ),
            patch("routers.ai.ask_question_async", chatbot),
            TestClient(app) as client,
        ):
            accepted = client.post(
                "/ai/chat",
                json={"question": "Tình hình báo cáo?"},
            )
            rejected = client.post(
                "/ai/chat",
                json={"question": "Tình hình báo cáo?", "xa_id": "commune_b"},
            )
    finally:
        app.dependency_overrides.clear()

    assert accepted.status_code == 200, accepted.text
    assert chatbot.await_args_list[0].kwargs["xa_id"] == "commune_a"
    assert rejected.status_code == 403, rejected.text
    assert chatbot.await_count == 1


def test_authenticated_chat_fails_closed_without_profile_commune() -> None:
    app = create_app()
    app.dependency_overrides[get_optional_user] = lambda: UserProfile(
        id="11111111-1111-4111-8111-111111111111",
        role="admin_xa",
        village_id=None,
        force_password_reset=False,
        commune_id=None,
    )
    chatbot = AsyncMock(side_effect=AssertionError("query must not run"))
    try:
        with (
            patch(
                "routers.ai.load_settings",
                return_value=SimpleNamespace(bana_commune_id="ba_na"),
            ),
            patch("routers.ai.ask_question_async", chatbot),
            TestClient(app) as client,
        ):
            response = client.post(
                "/ai/chat",
                json={"question": "Tình hình báo cáo?"},
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403, response.text
    assert chatbot.await_count == 0
