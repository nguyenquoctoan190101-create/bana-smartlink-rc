"""Safety and regression tests for the optional report AI narrative endpoint."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from routers.reports import ReportNarrativeRequest, create_report_narrative


VALID_VALUES = {
    "CT01": 320,
    "CT02": 1200,
    "CT03": 12,
    "CT04": 20,
    "CT05": 4,
    "CT06": 14,
    "CT07": 210,
    "CT08": 3,
    "CT09": 280,
    "CT10": 75,
    "CT11": 18,
    "CT12": 7,
    "CT13": 420,
    "CT14": 999,
}


class FakeGemini:
    def __init__(self) -> None:
        self.kwargs: dict = {}

    async def generate_json(self, **kwargs):  # type: ignore[no-untyped-def]
        self.kwargs = kwargs
        return {
            "warnings": ["CT13 cần được đối chiếu với nguồn nhập."],
            "recommendations": ["Kiểm tra nguồn nhập CT13 trước khi nộp."],
        }


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/reports/ai-narrative",
            "headers": [],
            "client": ("127.0.0.1", 4000),
        }
    )


def test_ai_narrative_excludes_ct14_and_returns_non_authoritative_advice() -> None:
    fake = FakeGemini()
    payload = ReportNarrativeRequest(values=VALID_VALUES, period_name="Tháng 7/2026")

    with patch("routers.reports.get_gemini_client", return_value=fake):
        result = asyncio.run(create_report_narrative(_request(), payload, None))

    assert result.is_valid is True
    assert result.source == "gemini"
    assert result.warnings
    assert "CT14" not in fake.kwargs["user_text"]
    assert "999" not in fake.kwargs["user_text"]


def test_ai_narrative_keeps_blocking_validation_deterministic() -> None:
    values = dict(VALID_VALUES)
    values["CT01"] = None

    with patch("routers.reports.get_gemini_client") as gemini:
        result = asyncio.run(create_report_narrative(_request(), ReportNarrativeRequest(values=values), None))

    assert result.is_valid is False
    assert result.source == "deterministic"
    assert result.errors
    gemini.assert_not_called()


def test_ai_narrative_rejects_unknown_indicator() -> None:
    values = dict(VALID_VALUES)
    values["CT99"] = 1

    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_report_narrative(_request(), ReportNarrativeRequest(values=values), None))

    assert exc.value.status_code == 422
