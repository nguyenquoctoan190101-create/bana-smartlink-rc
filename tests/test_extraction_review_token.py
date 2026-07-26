from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import extraction_review


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        extraction_review_signing_key="test-signing-key-with-enough-entropy",
        supabase_service_role_key="",
        app_env="test",
    )


def _values() -> dict[str, int]:
    return {f"CT{index:02d}": index for index in range(1, 15)}


def test_review_token_round_trip_is_user_bound(monkeypatch) -> None:
    monkeypatch.setattr(extraction_review, "load_settings", _settings)
    token = extraction_review.issue_extraction_review_token(
        user_id="user-a",
        source_checksum="a" * 64,
        source_type="excel",
        extractor_versions=["excel:1", "excel:1"],
        values=_values(),
        requires_review_count=2,
        now=1_000,
    )

    payload = extraction_review.verify_extraction_review_token(
        token,
        user_id="user-a",
        now=1_100,
    )

    assert payload["values"]["CT14"] == 14
    assert payload["extractor_versions"] == ["excel:1"]
    with pytest.raises(extraction_review.ExtractionReviewTokenError):
        extraction_review.verify_extraction_review_token(
            token,
            user_id="user-b",
            now=1_100,
        )


def test_review_token_rejects_tampering_and_expiry(monkeypatch) -> None:
    monkeypatch.setattr(extraction_review, "load_settings", _settings)
    token = extraction_review.issue_extraction_review_token(
        user_id="user-a",
        source_checksum="b" * 64,
        source_type="photo_ocr",
        extractor_versions=["ocr:2"],
        values=_values(),
        requires_review_count=14,
        now=1_000,
    )
    body, signature = token.split(".", 1)

    with pytest.raises(extraction_review.ExtractionReviewTokenError):
        extraction_review.verify_extraction_review_token(
            f"{body[:-1]}A.{signature}",
            user_id="user-a",
            now=1_100,
        )
    with pytest.raises(extraction_review.ExtractionReviewTokenError):
        extraction_review.verify_extraction_review_token(
            token,
            user_id="user-a",
            now=1_000 + extraction_review.TOKEN_TTL_SECONDS + 1,
        )
