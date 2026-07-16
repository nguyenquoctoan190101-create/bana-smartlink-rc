from __future__ import annotations

import pytest

from services.chatbot import _classify_question


@pytest.mark.parametrize(
    ("question", "expected_villages", "expected_ct"),
    [
        (
            "Thôn An Sơn có bao nhiêu hộ dân?",
            ["Thôn An Sơn"],
            "CT01",
        ),
        (
            "So sánh hộ dân giữa thôn An Sơn và thôn Phú Hòa?",
            ["Thôn An Sơn", "Thôn Phú Hòa"],
            "CT01",
        ),
    ],
)
def test_chatbot_uses_canonical_village_names(
    question: str,
    expected_villages: list[str],
    expected_ct: str,
) -> None:
    parsed = _classify_question(question)

    assert parsed.village_names == expected_villages
    assert parsed.ct_code == expected_ct
