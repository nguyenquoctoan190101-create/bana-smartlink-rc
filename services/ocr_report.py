from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from services.gemini import GeminiError  # noqa: F401
from services.settings import load_settings
from services.validator import ValidationError, validate_report

RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"

# Fraction of image height to remove from the TOP (personal-data header).
# The form header (name/phone/date) occupies roughly the top 28% of the form.
_TABLE_TOP_RATIO: float = 0.28

_OCR_SYSTEM_PROMPT = (
    "Ban la he thong OCR chinh xac cho phieu bao cao hanh chinh Viet Nam. "
    "Doc bang so lieu trong anh va tra ve JSON thuan tuy, "
    "khong them bat ky giai thich nao. "
    "Chi duoc tra ve so nguyen hoac null cho moi o. "
    "Neu mot o bi mo, bi che khuat hoac khong ro rang, tra ve null -- "
    "tuyet doi khong duoc doan hoac suy dien so lieu."
)

_OCR_USER_PROMPT = (
    "Doc bang so lieu trong anh, tra ve JSON "
    "{CT01: <so hoac null neu khong doc duoc>, CT02, CT03, CT04, CT05, CT06, "
    "CT07, CT08, CT09, CT10, CT11, CT12, CT13, CT14}. "
    "Neu khong chac chan mot o, tra null thay vi doan. "
    "Tra ve JSON thuan tuy -- khong bao kem markdown hay mo ta."
)

_OCR_MAX_TOKENS = 512
_OCR_TEMPERATURE = 0.0

_MIME_BY_MAGIC: dict[bytes, str] = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
}


class OcrError(RuntimeError):
    """Raised when the OCR pipeline cannot produce a usable result."""


@dataclass(frozen=True)
class OcrPreview:
    """Read-only OCR result returned for human review before saving.

    Attributes
    ----------
    values : dict[str, int | None]
        CT01-CT14 values parsed from the image. None = unreadable.
    flags : list[ValidationError]
        Standard validation warnings (same as web/Excel submissions).
    null_codes : list[str]
        CT codes where Gemini returned null (require manual entry).
    raw_gemini_text : str
        Raw Gemini response for server-side audit ONLY.
        MUST NOT be forwarded to the frontend.
    """

    values: dict[str, int | None]
    flags: list[ValidationError]
    null_codes: list[str]
    raw_gemini_text: str = field(repr=False)


def extract_table_region(image_bytes: bytes) -> bytes:
    """Return image bytes containing ONLY the data table portion.

    Removes the top _TABLE_TOP_RATIO fraction of the image.
    This strips the reporter name, phone, commune, and date fields.
    Only the CT01-CT14 numeric table is returned for Gemini transmission.
    Fails closed if the privacy crop cannot be performed.
    """
    try:
        from PIL import Image, ImageOps  # type: ignore[import]
    except ImportError as exc:
        raise OcrError("OCR privacy processing is unavailable") from exc

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            img = ImageOps.exif_transpose(source)
            img.load()
            width, height = img.size
            upper = int(height * _TABLE_TOP_RATIO)
            if width <= 0 or height <= 0 or upper <= 0 or upper >= height:
                raise OcrError("Image cannot be cropped safely")
            cropped = img.crop((0, upper, width, height))
            buf = BytesIO()
            fmt = "JPEG" if _detect_mime(image_bytes) == "image/jpeg" else "PNG"
            if fmt == "JPEG" and cropped.mode not in {"RGB", "L"}:
                cropped = cropped.convert("RGB")
            cropped.save(buf, format=fmt, **{"quality": 92} if fmt == "JPEG" else {})
            return buf.getvalue()
    except OcrError:
        raise
    except (OSError, ValueError) as exc:
        raise OcrError("OCR image preprocessing failed") from exc


def _load_indicator_codes() -> list[str]:
    with RULES_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    return [
        str(ind["code"]).strip().upper()
        for ind in payload.get("indicators", [])
        if isinstance(ind, dict) and ind.get("code")
    ]


async def _call_gemini_ocr(cropped_bytes: bytes) -> str:
    """POST cropped image to Gemini multimodal endpoint; return raw text.

    Uses inline_data (base64-encoded) in the JSON payload.
    Only the CROPPED data table is transmitted -- never the full form.
    """
    import httpx

    settings = load_settings()
    if not settings.gemini_api_key:
        raise OcrError("Gemini OCR is not configured")
    mime = _detect_mime(cropped_bytes)
    b64_data = base64.b64encode(cropped_bytes).decode("ascii")

    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": _OCR_SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": b64_data}},
                    {"text": _OCR_USER_PROMPT},
                ],
            }
        ],
        "generationConfig": {
            "maxOutputTokens": _OCR_MAX_TOKENS,
            "temperature": _OCR_TEMPERATURE,
            "responseMimeType": "application/json",
        },
    }

    base_url = settings.gemini_api_url.rstrip("/")
    model = settings.gemini_model
    url = f"{base_url}/v1beta/models/{model}:generateContent"

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                url,
                params={"key": settings.gemini_api_key},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise OcrError("Gemini OCR request failed (network error)") from exc

    if response.status_code >= 400:
        raise OcrError(f"Gemini OCR request failed (HTTP {response.status_code})")

    from services.gemini import _extract_text
    try:
        return _extract_text(response.json())
    except GeminiError as exc:
        raise OcrError("Could not parse Gemini OCR response") from exc


def parse_ocr_result(raw_text: str) -> dict[str, int | None]:
    """Safely parse Gemini JSON output into a CT01-CT14 value dict.

    Rules
    -----
    - Only CT codes present in validation_rules.json are accepted.
    - int values are kept; float values are cast to int if whole-number.
    - Numeric strings are cast to int; any other type becomes None.
    - Keys absent from Gemini output default to None (unreadable).
    - Unknown keys from Gemini output are silently discarded.
    """
    known_codes = _load_indicator_codes()
    result: dict[str, int | None] = {code: None for code in known_codes}

    # Strip Markdown code fences in case Gemini added them
    import re as _re
    cleaned = _re.sub(r"```(?:json)?\s*", "", raw_text).strip().rstrip("`").strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        m = _re.search(r"\{[^{}]+\}", cleaned, _re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
            except json.JSONDecodeError as exc:
                raise OcrError("Gemini returned invalid OCR JSON") from exc
        else:
            raise OcrError("Gemini returned no OCR JSON object")

    if not isinstance(parsed, dict):
        raise OcrError("Gemini OCR response is not a JSON object")

    for code in known_codes:
        raw_val = parsed.get(code)
        if raw_val is None:
            result[code] = None
        elif isinstance(raw_val, bool):
            result[code] = None  # JSON booleans must not become ints
        elif isinstance(raw_val, int):
            result[code] = raw_val
        elif isinstance(raw_val, float) and raw_val == int(raw_val):
            result[code] = int(raw_val)
        elif isinstance(raw_val, str):
            s = raw_val.strip()
            result[code] = int(s) if s.lstrip("-").isdigit() else None
        else:
            result[code] = None

    return result


def validate_ocr_report(values: dict[str, int | None]) -> list[ValidationError]:
    """Run the standard validator on OCR-extracted values.

    Identical to the validation path used by web-form and Excel uploads.
    BLANK errors for null OCR values are expected (cells Gemini could not
    read) and are surfaced to the user as cells requiring manual entry.
    """
    return validate_report(values)


async def ocr_report_async(image_bytes: bytes) -> OcrPreview:
    """Full OCR pipeline: privacy crop -> Gemini multimodal -> parse -> validate.

    Parameters
    ----------
    image_bytes : bytes
        Raw bytes of a JPEG or PNG photo of the paper report form.

    Returns
    -------
    OcrPreview
        Read-only result with extracted values, validation flags, and the
        list of unreadable (null) CT codes for manual completion.

    Privacy guarantee
    -----------------
    Only the cropped data table (below the personal-data header) is ever
    transmitted to Gemini.  The reporter name and phone are stripped first.

    Confirmation requirement (AI does-not-decide principle)
    ---------------------------------------------------------
    The result is NEVER saved automatically.  The calling layer (FastAPI
    router) MUST return OcrPreview to the frontend and wait for the can bo
    to review, correct, and explicitly confirm before calling the save route.
    """
    # 1. Privacy crop: PII header is stripped here, NEVER sent to Gemini
    cropped = extract_table_region(image_bytes)

    # 2. Send the cropped table-only image to Gemini multimodal endpoint
    raw_text = await _call_gemini_ocr(cropped)

    # 3. Safely parse and sanitise Gemini JSON output
    values = parse_ocr_result(raw_text)

    # 4. Identify cells Gemini could not read (require manual entry)
    null_codes = [code for code, val in values.items() if val is None]

    # 5. Validate through standard path (same as photo_upload source)
    flags = validate_ocr_report(values)

    return OcrPreview(
        values=values,
        flags=flags,
        null_codes=null_codes,
        raw_gemini_text=raw_text,  # server-side audit ONLY -- NOT sent to client
    )


def _detect_mime(image_bytes: bytes) -> str:
    """Detect image MIME type from magic bytes."""
    for magic, mime in _MIME_BY_MAGIC.items():
        if image_bytes.startswith(magic):
            return mime
    raise OcrError("Unsupported OCR image format")


__all__ = [
    "OcrError",
    "OcrPreview",
    "extract_table_region",
    "ocr_report_async",
    "parse_ocr_result",
    "validate_ocr_report",
]
