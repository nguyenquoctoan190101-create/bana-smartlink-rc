from pathlib import Path

from scripts.export_openapi import OUTPUT, normalized_openapi


def test_committed_openapi_contract_has_no_drift() -> None:
    assert OUTPUT == Path(__file__).resolve().parents[1] / "docs" / "openapi.json"
    assert OUTPUT.read_text(encoding="utf-8") == normalized_openapi()
