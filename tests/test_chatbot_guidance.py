from __future__ import annotations

import asyncio

import pytest

from services.chatbot import ask_question_async


@pytest.mark.parametrize(
    "question",
    [
        "Bạn biết những gì?",
        "Tôi cần hỏi thế nào mới được trả lời?",
    ],
)
def test_public_help_questions_return_actionable_guidance(question: str) -> None:
    result = asyncio.run(ask_question_async(question, caller_role="dan"))

    assert result.rows_retrieved == 0
    assert "5 chỉ tiêu" in result.answer
    assert "Thôn Phú Hòa" in result.answer


def test_public_private_indicator_explains_scope() -> None:
    result = asyncio.run(
        ask_question_async(
            "Thôn Phú Hòa có bao nhiêu hộ nghèo?",
            caller_role="dan",
        )
    )

    assert result.rows_retrieved == 0
    assert "không thuộc phạm vi dữ liệu công khai" in result.answer
    assert "CT14" in result.answer


def test_public_question_without_village_requests_a_name() -> None:
    result = asyncio.run(
        ask_question_async("Thôn tôi có bao nhiêu hộ dân?", caller_role="dan")
    )

    assert result.rows_retrieved == 0
    assert "nêu rõ tên thôn" in result.answer
