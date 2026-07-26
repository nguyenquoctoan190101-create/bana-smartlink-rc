from __future__ import annotations

import json
from io import BytesIO
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas

from main import create_app
from routers.auth import get_settings, require_authenticated_user
from services import ocr_report
from services.settings import Settings
from services.supabase_admin import UserProfile


def _client() -> tuple[TestClient, object]:
    app = create_app()
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=str(uuid4()),
        force_password_reset=False,
    )
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None,
        app_env="test",
        feature_external_ocr=True,
    )
    return TestClient(app), app


def test_external_ocr_is_disabled_by_default() -> None:
    app = create_app()
    app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=str(uuid4()),
        force_password_reset=False,
    )
    try:
        response = TestClient(app).post(
            "/reports/ocr-preview",
            files={"file": ("scan.png", _png_scan(), "image/png")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert "tạm thời không sẵn sàng" in response.json()["message"]


def test_import_capabilities_are_backend_confirmed() -> None:
    disabled_app = create_app()
    disabled_app.dependency_overrides[require_authenticated_user] = lambda: UserProfile(
        id=str(uuid4()),
        role="can_bo_thon",
        village_id=str(uuid4()),
        force_password_reset=False,
    )
    try:
        disabled = TestClient(disabled_app).get("/reports/capabilities")
    finally:
        disabled_app.dependency_overrides.clear()

    assert disabled.status_code == 200
    assert disabled.json() == {
        "excel_preview_enabled": True,
        "ocr_preview_enabled": False,
        "accepted_ocr_types": [],
    }

    enabled_client, enabled_app = _client()
    try:
        enabled = enabled_client.get("/reports/capabilities")
    finally:
        enabled_app.dependency_overrides.clear()

    assert enabled.status_code == 200
    assert enabled.json() == {
        "excel_preview_enabled": True,
        "ocr_preview_enabled": True,
        "accepted_ocr_types": [".jpg", ".jpeg", ".png", ".pdf"],
    }


def _scan_image(*, include_table: bool = True, include_mid_page_pii: bool = False) -> Image.Image:
    image = Image.new("RGB", (300, 600), "white")
    drawing = ImageDraw.Draw(image)
    drawing.text((20, 40), "PHIEU BAO CAO", fill="black")
    if include_mid_page_pii:
        drawing.rectangle((20, 210, 180, 245), fill=(220, 0, 0))
        drawing.text((24, 220), "TEN / SO DIEN THOAI", fill="white")
    if include_table:
        left, top, right, bottom = 20, 320, 280, 580
        drawing.rectangle((left, top, right, bottom), outline="black", width=3)
        drawing.line((105, top, 105, bottom), fill="black", width=3)
        drawing.line((210, top, 210, bottom), fill="black", width=3)
        for y in range(top + 40, bottom, 40):
            drawing.line((left, y, right, y), fill="black", width=3)
        drawing.text((30, top + 12), "CT01", fill="black")
        drawing.text((220, top + 12), "145", fill="black")
    return image


def _scanned_pdf() -> bytes:
    image = _scan_image()
    output = BytesIO()
    image.save(output, format="PDF", resolution=150)
    return output.getvalue()


def _png_scan() -> bytes:
    image = _scan_image()
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _ambiguous_two_table_scan() -> bytes:
    image = Image.new("RGB", (400, 800), "white")
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((20, 80, 380, 420), outline="black", width=4)
    drawing.line((160, 80, 160, 420), fill="black", width=4)
    for y in range(120, 421, 40):
        drawing.line((20, y, 380, y), fill="black", width=4)
    drawing.rectangle((175, 170, 360, 210), fill=(230, 0, 0))
    drawing.text((180, 182), "TEN / SO DIEN THOAI", fill="white")

    drawing.rectangle((20, 500, 380, 760), outline="black", width=4)
    drawing.line((160, 500, 160, 760), fill="black", width=4)
    for y in (560, 620, 680):
        drawing.line((20, y, 380, y), fill="black", width=4)
    drawing.text((30, 520), "CT01", fill="black")

    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _vector_pdf() -> bytes:
    output = BytesIO()
    document = canvas.Canvas(output)
    document.drawString(20, 700, "CT01 145")
    document.save()
    return output.getvalue()


def test_pdf_ocr_preview_returns_additive_evidence_without_persisting(
    monkeypatch,
) -> None:
    async def fake_ocr(_: bytes) -> str:
        return json.dumps(
            {
                "CT01": {
                    "raw_value": "145",
                    "normalized_value": 145,
                    "confidence": 0.93,
                },
                "CT02": {
                    "raw_value": "không rõ",
                    "normalized_value": None,
                    "confidence": 0.7,
                },
            }
        )

    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", fake_ocr)
    persist = AsyncMock(side_effect=AssertionError("preview must not persist"))
    monkeypatch.setattr("routers.reports._submit_report_values", persist)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={"file": ("scan.pdf", _scanned_pdf(), "application/pdf")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "pdf_ocr"
    assert payload["values"]["CT01"] == 145
    assert payload["raw_values"]["CT01"] == "145"
    assert payload["values"]["CT02"] is None
    assert payload["raw_values"]["CT02"] == "không rõ"
    assert "raw_gemini_text" not in payload
    assert persist.await_count == 0

    evidence = payload["evidence"]["CT01"]
    assert evidence["normalized_value"] == 145
    assert evidence["confidence"] == 0.93
    assert evidence["source_page"] == 1
    assert evidence["source_region"] == "data_table"
    assert evidence["extractor"] == "gemini_multimodal"
    assert evidence["method"] == "table_only_raster_ocr"
    assert evidence["version"] == "2.0"
    assert "AI_CONFIDENCE_UNCALIBRATED" in evidence["flags"]
    assert evidence["requires_review"] is True

    unreadable = payload["evidence"]["CT02"]
    assert unreadable["confidence"] == 0.0
    assert "UNPARSEABLE" in unreadable["flags"]
    assert "CT02" in payload["null_codes"]

    import_metadata = payload["import_metadata"]
    assert import_metadata["source_type"] == "pdf_ocr"
    assert import_metadata["template_version"] == "ct14-official-2026-07"
    assert import_metadata["rule_version"] == "2026-07-14"
    assert len(import_metadata["evidence_sha256"]) == 64
    assert import_metadata["evidence"]["CT01"]["source_page"] == 1
    assert import_metadata["evidence"]["CT01"]["requires_review"] is True
    assert import_metadata["quality_summary"]["status"] == "blocked"
    assert import_metadata["quality_summary"]["blocking_flag_count"] >= 1


def test_image_ocr_preview_preserves_legacy_scalar_contract(monkeypatch) -> None:
    async def fake_ocr(_: bytes) -> str:
        return json.dumps({"CT01": 145})

    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", fake_ocr)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={"file": ("scan.png", _png_scan(), "image/png")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"] == "photo_ocr"
    assert payload["values"]["CT01"] == 145
    assert payload["raw_values"]["CT01"] == 145
    assert payload["evidence"]["CT01"]["confidence"] == 0.5
    assert payload["import_metadata"]["source_type"] == "photo_ocr"
    assert payload["metadata"] is None
    assert set(
        {
            "values",
            "raw_values",
            "flags",
            "null_codes",
            "filename",
            "size_bytes",
            "source",
            "metadata",
        }
    ).issubset(payload)


def test_ocr_preview_rejects_vector_pdf_before_external_call(monkeypatch) -> None:
    external_call = AsyncMock(side_effect=AssertionError("must fail before OCR call"))
    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", external_call)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={"file": ("vector.pdf", _vector_pdf(), "application/pdf")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400, response.text
    assert external_call.await_count == 0


def test_ocr_preview_rejects_extension_magic_mismatch(monkeypatch) -> None:
    external_call = AsyncMock(side_effect=AssertionError("must fail before OCR call"))
    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", external_call)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={"file": ("fake.pdf", b"\x89PNG\r\n\x1a\n", "application/pdf")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400, response.text
    assert external_call.await_count == 0


def test_privacy_crop_excludes_pii_below_old_fixed_header_boundary() -> None:
    output = BytesIO()
    _scan_image(include_mid_page_pii=True).save(output, format="PNG")

    cropped = ocr_report.extract_table_region(output.getvalue())

    with Image.open(BytesIO(cropped)) as image:
        red_pixels = sum(
            1
            for red, green, blue in image.convert("RGB").get_flattened_data()
            if red > 180 and green < 40 and blue < 40
        )
        assert red_pixels == 0
        assert image.height < 300


def test_ocr_preview_rejects_unbounded_scan_before_external_call(monkeypatch) -> None:
    output = BytesIO()
    _scan_image(include_table=False, include_mid_page_pii=True).save(
        output,
        format="PNG",
    )
    external_call = AsyncMock(side_effect=AssertionError("must fail before OCR call"))
    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", external_call)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={"file": ("unsafe.png", output.getvalue(), "image/png")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400, response.text
    assert external_call.await_count == 0


def test_ocr_preview_rejects_multiple_independent_tables_before_external_call(
    monkeypatch,
) -> None:
    external_call = AsyncMock(side_effect=AssertionError("must fail before OCR call"))
    monkeypatch.setattr(ocr_report, "_call_gemini_ocr", external_call)
    client, app = _client()
    try:
        response = client.post(
            "/reports/ocr-preview",
            files={
                "file": (
                    "identity-and-report.png",
                    _ambiguous_two_table_scan(),
                    "image/png",
                )
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400, response.text
    assert external_call.await_count == 0
