from __future__ import annotations

import base64
import json
import math
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from services.gemini import GeminiError  # noqa: F401
from services.settings import load_settings
from services.upload_validator import MAX_IMAGE_PIXELS, MAX_PDF_PAGES
from services.validator import (
    ValidationError,
    coerce_storage_value,
    validate_report,
)

RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"

# Privacy boundary detection is deliberately conservative. A page is sent to
# the OCR provider only when a wide, multi-row table with both vertical edges
# can be located deterministically. Otherwise the request fails closed and the
# user can enter the report manually.
_TABLE_MIN_WIDTH_RATIO = 0.45
_TABLE_MIN_HEIGHT_RATIO = 0.12
_TABLE_MIN_HORIZONTAL_LINES = 4
_TABLE_MIN_VERTICAL_COVERAGE = 0.42
_TABLE_ANALYSIS_MAX_WIDTH = 1200
_TABLE_ANALYSIS_MAX_HEIGHT = 1800

_OCR_SYSTEM_PROMPT = (
    "Ban la he thong OCR chinh xac cho phieu bao cao hanh chinh Viet Nam. "
    "Doc bang so lieu trong anh va tra ve JSON thuan tuy, "
    "khong them bat ky giai thich nao. "
    "Chi duoc tra ve so nguyen hoac null cho moi o. "
    "Neu mot o bi mo, bi che khuat hoac khong ro rang, tra ve null -- "
    "tuyet doi khong duoc doan hoac suy dien so lieu."
)

_OCR_USER_PROMPT = (
    "Doc bang so lieu trong anh, tra ve JSON cho CT01 den CT14. "
    "Moi chi tieu co dang "
    '{"raw_value": <chuoi nhin thay hoac null>, '
    '"normalized_value": <so nguyen hoac null>, '
    '"confidence": <so tu 0 den 1>}. '
    "Chi tra gia tri xuat hien tren trang nay. Neu khong chac chan mot o, "
    "tra null va confidence 0 thay vi doan. "
    "Tra ve JSON thuan tuy -- khong bao kem markdown hay mo ta."
)

_OCR_MAX_TOKENS = 1536
_OCR_TEMPERATURE = 0.0

_MIME_BY_MAGIC: dict[bytes, str] = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
}
_PDF_MAGIC = b"%PDF-"
_OCR_EXTRACTOR = "gemini_multimodal"
_OCR_METHOD = "table_only_raster_ocr"
_OCR_VERSION = "2.0"
_LOW_CONFIDENCE_THRESHOLD = 0.8
_MAX_PDF_IMAGES = 20
_MAX_PDF_IMAGE_PIXELS_TOTAL = 50_000_000


class OcrError(RuntimeError):
    """Raised when the OCR pipeline cannot produce a usable result."""


class OcrInputError(OcrError):
    """Raised when an uploaded OCR document cannot be processed safely."""


@dataclass(frozen=True)
class OcrFieldEvidence:
    """Per-field provenance for a non-persistent OCR preview."""

    raw_value: int | float | str | None
    normalized_value: int | None
    confidence: float
    source_page: int | None
    source_region: str | None
    extractor: str
    method: str
    version: str
    flags: list[str]
    requires_review: bool


@dataclass(frozen=True)
class OcrPreview:
    """Read-only OCR result returned for human review before saving.

    Attributes
    ----------
    values : dict[str, int | None]
        CT01-CT14 values parsed from the image. None = unreadable.
    raw_values : dict[str, int | float | str | None]
        Bounded primitive values exactly as returned for each CT field.
    flags : list[dict[str, str]]
        Standard validation warnings (same as web/Excel submissions).
    null_codes : list[str]
        CT codes where Gemini returned null (require manual entry).
    evidence : dict[str, OcrFieldEvidence]
        Per-field provenance, confidence, and human-review requirement.
    raw_gemini_text : str
        Raw Gemini response for server-side audit ONLY.
        MUST NOT be forwarded to the frontend.
    """

    values: dict[str, int | None]
    raw_values: dict[str, int | float | str | None]
    flags: list[dict[str, str]]
    null_codes: list[str]
    evidence: dict[str, OcrFieldEvidence]
    raw_gemini_text: str = field(repr=False)


def _longest_dark_run(
    pixels: Any,
    *,
    y: int,
    width: int,
    threshold: int,
    max_gap: int,
) -> tuple[int, int, int]:
    """Return the widest near-contiguous dark run in one raster row."""
    best = (0, 0, 0)
    start: int | None = None
    last_dark: int | None = None
    dark_count = 0
    for x in range(width):
        if pixels[x, y] >= threshold:
            continue
        if start is None:
            start = x
            last_dark = x
            dark_count = 1
            continue
        if last_dark is not None and x - last_dark <= max_gap + 1:
            last_dark = x
            dark_count += 1
            continue
        if last_dark is not None and last_dark - start > best[1] - best[0]:
            best = (start, last_dark, dark_count)
        start = x
        last_dark = x
        dark_count = 1
    if start is not None and last_dark is not None and last_dark - start > best[1] - best[0]:
        best = (start, last_dark, dark_count)
    return best


def _cluster_nearby(values: list[int], *, distance: int) -> list[list[int]]:
    clusters: list[list[int]] = []
    for value in values:
        if not clusters or value - clusters[-1][-1] > distance:
            clusters.append([value])
        else:
            clusters[-1].append(value)
    return clusters


def _detect_table_bounds(image: Any) -> tuple[int, int, int, int]:
    """Locate a bordered data table and return bounds in analysis coordinates."""
    from PIL import ImageOps  # type: ignore[import]

    grayscale = ImageOps.autocontrast(image.convert("L"))
    width, height = grayscale.size
    if width <= 0 or height <= 0:
        raise OcrInputError("Không thể xác định vùng bảng dữ liệu an toàn")

    pixels = grayscale.load()
    threshold = 175
    max_gap = max(2, width // 400)
    minimum_span = int(width * _TABLE_MIN_WIDTH_RATIO)
    row_runs: dict[int, tuple[int, int, int]] = {}
    for y in range(height):
        run = _longest_dark_run(
            pixels,
            y=y,
            width=width,
            threshold=threshold,
            max_gap=max_gap,
        )
        span = run[1] - run[0] + 1
        if span >= minimum_span and run[2] / span >= 0.55:
            row_runs[y] = run

    row_clusters = _cluster_nearby(
        sorted(row_runs),
        distance=max(2, height // 900),
    )
    horizontal_lines: list[tuple[int, int, int]] = []
    for cluster in row_clusters:
        representative = max(
            cluster,
            key=lambda row: (
                row_runs[row][1] - row_runs[row][0],
                row_runs[row][2],
            ),
        )
        left, right, _ = row_runs[representative]
        horizontal_lines.append((representative, left, right))

    endpoint_tolerance = max(6, int(width * 0.06))
    endpoint_groups: list[list[tuple[int, int, int]]] = []
    seen_groups: set[tuple[int, ...]] = set()
    for _, seed_left, seed_right in horizontal_lines:
        group = [
            line
            for line in horizontal_lines
            if abs(line[1] - seed_left) <= endpoint_tolerance
            and abs(line[2] - seed_right) <= endpoint_tolerance
        ]
        signature = tuple(sorted(line[0] for line in group))
        if len(group) >= _TABLE_MIN_HORIZONTAL_LINES and signature not in seen_groups:
            seen_groups.add(signature)
            endpoint_groups.append(group)

    vertical_band = max(2, width // 500)
    boundary_gap = max(4, height // 180)
    candidates: list[tuple[int, int, int, int]] = []

    def has_dark_boundary(center_x: int, y: int) -> bool:
        start = max(0, center_x - vertical_band)
        end = min(width, center_x + vertical_band + 1)
        return any(pixels[x, y] < threshold for x in range(start, end))

    for group in endpoint_groups:
        group.sort()
        left = sorted(line[1] for line in group)[len(group) // 2]
        right = sorted(line[2] for line in group)[len(group) // 2]
        if right - left < minimum_span:
            continue

        # Segment continuous pairs of vertical borders before grouping the
        # horizontal rules. Two separate tables with similar endpoints must
        # never be merged into one crop: the upper table may contain identity
        # fields while the lower table contains CT01-CT14.
        paired_boundary_rows = [
            y
            for y in range(height)
            if has_dark_boundary(left, y) and has_dark_boundary(right, y)
        ]
        for boundary_cluster in _cluster_nearby(
            paired_boundary_rows,
            distance=boundary_gap,
        ):
            segment_top = boundary_cluster[0]
            segment_bottom = boundary_cluster[-1]
            segment_lines = [
                line
                for line in group
                if segment_top - boundary_gap <= line[0] <= segment_bottom + boundary_gap
            ]
            if len(segment_lines) < _TABLE_MIN_HORIZONTAL_LINES:
                continue
            top = min(line[0] for line in segment_lines)
            bottom = max(line[0] for line in segment_lines)
            if bottom - top < height * _TABLE_MIN_HEIGHT_RATIO:
                continue

            def vertical_coverage(center_x: int) -> float:
                dark_rows = sum(
                    1
                    for y in range(top, bottom + 1)
                    if has_dark_boundary(center_x, y)
                )
                return dark_rows / max(1, bottom - top + 1)

            if (
                vertical_coverage(left) < _TABLE_MIN_VERTICAL_COVERAGE
                or vertical_coverage(right) < _TABLE_MIN_VERTICAL_COVERAGE
            ):
                continue
            candidate = (left, top, right, bottom)
            if not any(
                all(
                    abs(value - prior) <= boundary_gap
                    for value, prior in zip(candidate, existing)
                )
                for existing in candidates
            ):
                candidates.append(candidate)

    if len(candidates) != 1:
        reason = (
            "Phát hiện nhiều bảng có thể chứa thông tin cá nhân"
            if len(candidates) > 1
            else "Không xác định được bảng dữ liệu đủ an toàn"
        )
        raise OcrInputError(f"{reason}; vui lòng nhập thủ công")

    left, top, right, bottom = candidates[0]
    margin = max(1, min(width, height) // 500)
    return (
        max(0, left - margin),
        max(0, top - margin),
        min(width, right + margin + 1),
        min(height, bottom + margin + 1),
    )


def extract_table_region(image_bytes: bytes) -> bytes:
    """Return only a confidently detected, bordered data-table raster.

    No position-based crop is used. If a table boundary cannot be verified,
    the function fails before any page bytes can reach the OCR provider.
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
            if width <= 0 or height <= 0:
                raise OcrInputError("Không thể tách vùng dữ liệu an toàn từ ảnh")
            analysis = img.copy()
            analysis.thumbnail(
                (_TABLE_ANALYSIS_MAX_WIDTH, _TABLE_ANALYSIS_MAX_HEIGHT),
                Image.Resampling.LANCZOS,
            )
            left, top, right, bottom = _detect_table_bounds(analysis)
            scale_x = width / analysis.width
            scale_y = height / analysis.height
            crop_box = (
                max(0, math.floor(left * scale_x)),
                max(0, math.floor(top * scale_y)),
                min(width, math.ceil(right * scale_x)),
                min(height, math.ceil(bottom * scale_y)),
            )
            if crop_box[2] <= crop_box[0] or crop_box[3] <= crop_box[1]:
                raise OcrInputError("Không thể tách vùng dữ liệu an toàn từ ảnh")
            cropped = img.crop(crop_box)
            buf = BytesIO()
            fmt = "JPEG" if _detect_mime(image_bytes) == "image/jpeg" else "PNG"
            if fmt == "JPEG" and cropped.mode not in {"RGB", "L"}:
                cropped = cropped.convert("RGB")
            cropped.save(buf, format=fmt, **{"quality": 92} if fmt == "JPEG" else {})
            return buf.getvalue()
    except OcrError:
        raise
    except (OSError, ValueError) as exc:
        raise OcrInputError("Ảnh bị lỗi hoặc không thể xử lý an toàn") from exc


def _sanitize_raster_image(image_bytes: bytes) -> bytes:
    """Decode and re-encode a raster page, removing metadata and hidden payloads."""
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError  # type: ignore[import]
    except ImportError as exc:
        raise OcrError("OCR privacy processing is unavailable") from exc

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            width, height = source.size
            if (
                width <= 0
                or height <= 0
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise OcrInputError("Kích thước ảnh quét trong PDF không hợp lệ")
            sanitized = ImageOps.exif_transpose(source)
            sanitized.load()
            if sanitized.mode not in {"RGB", "L"}:
                sanitized = sanitized.convert("RGB")
            output = BytesIO()
            sanitized.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except OcrError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise OcrInputError("PDF không chứa ảnh quét có thể xử lý") from exc


def _preflight_pdf_page_images(page: Any) -> None:
    """Bound image dimensions/count before pypdf decompresses image streams."""
    resources_ref = page.get("/Resources")
    if resources_ref is None:
        return

    pending = [resources_ref]
    seen: set[tuple[int, int] | int] = set()
    image_count = 0
    total_pixels = 0

    while pending:
        current_ref = pending.pop()
        identity: tuple[int, int] | int
        if hasattr(current_ref, "idnum"):
            identity = (int(current_ref.idnum), int(current_ref.generation))
        else:
            identity = id(current_ref)
        if identity in seen:
            continue
        seen.add(identity)

        resources = current_ref.get_object()
        xobjects_ref = resources.get("/XObject")
        if xobjects_ref is None:
            continue
        xobjects = xobjects_ref.get_object()
        for object_ref in xobjects.values():
            item = object_ref.get_object()
            subtype = str(item.get("/Subtype", ""))
            if subtype == "/Image":
                width = int(item.get("/Width", 0))
                height = int(item.get("/Height", 0))
                pixels = width * height
                if width <= 0 or height <= 0 or pixels > MAX_IMAGE_PIXELS:
                    raise OcrInputError(
                        "Kích thước ảnh quét trong PDF không hợp lệ"
                    )
                image_count += 1
                total_pixels += pixels
                if (
                    image_count > _MAX_PDF_IMAGES
                    or total_pixels > _MAX_PDF_IMAGE_PIXELS_TOTAL
                ):
                    raise OcrInputError("PDF chứa quá nhiều dữ liệu ảnh quét")
            elif subtype == "/Form":
                nested_resources = item.get("/Resources")
                if nested_resources is not None:
                    pending.append(nested_resources)


def extract_pdf_scan_pages(pdf_bytes: bytes) -> list[tuple[int, bytes]]:
    """Extract sanitized raster pages from a scanned PDF.

    Vector/text PDFs are intentionally rejected. Rendering them would require
    sending the original document or relying on an unpinned system renderer,
    either of which could bypass the privacy crop. Each accepted page must
    contain a decodable raster image and is re-encoded before further use.
    """
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as exc:
        raise OcrError("PDF OCR is unavailable") from exc

    try:
        reader = PdfReader(BytesIO(pdf_bytes), strict=True)
        if reader.is_encrypted:
            raise OcrInputError("Không chấp nhận tệp PDF được mã hóa")
        if not 1 <= len(reader.pages) <= MAX_PDF_PAGES:
            raise OcrInputError(
                f"Tệp PDF phải có từ 1 đến {MAX_PDF_PAGES} trang"
            )

        pages: list[tuple[int, bytes]] = []
        for page_number, page in enumerate(reader.pages, start=1):
            _preflight_pdf_page_images(page)
            candidates: list[tuple[int, bytes]] = []
            for image_file in page.images:
                sanitized = _sanitize_raster_image(image_file.data)
                try:
                    from PIL import Image  # type: ignore[import]

                    with Image.open(BytesIO(sanitized)) as image:
                        area = image.width * image.height
                except (OSError, ValueError) as exc:
                    raise OcrInputError(
                        "PDF không chứa ảnh quét có thể xử lý"
                    ) from exc
                candidates.append((area, sanitized))

            if not candidates:
                raise OcrInputError(
                    f"Trang {page_number} của PDF không phải ảnh quét"
                )
            _, largest_scan = max(candidates, key=lambda candidate: candidate[0])
            pages.append((page_number, largest_scan))
        return pages
    except OcrError:
        raise
    except (
        AttributeError,
        OverflowError,
        PdfReadError,
        KeyError,
        OSError,
        TypeError,
        ValueError,
    ) as exc:
        raise OcrInputError("Tệp PDF bị lỗi hoặc không thể xử lý an toàn") from exc


def prepare_ocr_pages(document_bytes: bytes) -> list[tuple[int, bytes]]:
    """Return privacy-cropped raster pages ready for the OCR provider."""
    if document_bytes.startswith(_PDF_MAGIC):
        scan_pages = extract_pdf_scan_pages(document_bytes)
    else:
        # _detect_mime validates the magic bytes before Pillow is invoked.
        _detect_mime(document_bytes)
        scan_pages = [(1, _sanitize_raster_image(document_bytes))]

    # Crop every page fail-closed. This may remove a repeated page heading,
    # but guarantees that names/phone numbers in the upper form header are
    # never transmitted to the external OCR provider.
    return [
        (page_number, extract_table_region(page_bytes))
        for page_number, page_bytes in scan_pages
    ]


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


def _parse_ocr_json(raw_text: str) -> dict[str, Any]:
    """Extract one JSON object from a provider response."""
    import re as _re

    cleaned = _re.sub(r"```(?:json)?\s*", "", raw_text).strip().rstrip("`").strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = _re.search(r"\{.*\}", cleaned, _re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError as exc:
                raise OcrError("Gemini returned invalid OCR JSON") from exc
        else:
            raise OcrError("Gemini returned no OCR JSON object")

    if not isinstance(parsed, dict):
        raise OcrError("Gemini OCR response is not a JSON object")
    return parsed


def _normalize_ocr_value(raw_value: Any) -> int | None:
    """Normalize only an unambiguous integer; never infer or round."""
    return coerce_storage_value(raw_value)


def _normalize_confidence(value: Any, *, has_value: bool) -> float:
    if not has_value:
        return 0.0
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        # Older scalar contracts contain no confidence. Keep a deliberately
        # conservative, visibly reviewable value rather than inventing 100%.
        return 0.5
    if not math.isfinite(float(value)):
        return 0.0
    return round(max(0.0, min(1.0, float(value))), 4)


def parse_ocr_evidence(
    raw_text: str,
) -> tuple[
    dict[str, int | float | str | None],
    dict[str, int | None],
    dict[str, float],
]:
    """Parse scalar or evidence-rich OCR JSON without trusting AI normalization.

    Rules
    -----
    - Only CT codes present in validation_rules.json are accepted.
    - The raw value is normalized locally using deterministic integer rules.
    - Provider confidence is clamped to 0..1 and never authorizes persistence.
    - Legacy scalar responses remain supported.
    - Keys absent from Gemini output default to None (unreadable).
    - Unknown keys from Gemini output are silently discarded.
    """
    known_codes = _load_indicator_codes()
    raw_values: dict[str, int | float | str | None] = {
        code: None for code in known_codes
    }
    values: dict[str, int | None] = {code: None for code in known_codes}
    confidences: dict[str, float] = {code: 0.0 for code in known_codes}
    parsed = _parse_ocr_json(raw_text)

    for code in known_codes:
        item = parsed.get(code)
        confidence_input: Any = None
        if isinstance(item, dict):
            if "raw_value" in item:
                raw_value = item.get("raw_value")
            elif "value" in item:
                raw_value = item.get("value")
            else:
                raw_value = item.get("normalized_value")
            confidence_input = item.get("confidence")
        else:
            raw_value = item

        # Bound the public raw contract to JSON primitives and do not echo
        # arbitrary nested provider output to the client.
        if raw_value is not None and (
            isinstance(raw_value, (dict, list, tuple, set, bool))
            or not isinstance(raw_value, (int, float, str))
        ):
            raw_value = None
        elif isinstance(raw_value, float) and not math.isfinite(raw_value):
            raw_value = None
        elif isinstance(raw_value, str):
            raw_value = raw_value.strip()[:64]
        raw_values[code] = raw_value
        normalized = _normalize_ocr_value(raw_value)
        values[code] = normalized
        confidences[code] = _normalize_confidence(
            confidence_input,
            has_value=normalized is not None,
        )

    return raw_values, values, confidences


def parse_ocr_result(raw_text: str) -> dict[str, int | None]:
    """Backward-compatible value-only view of :func:`parse_ocr_evidence`."""
    _, values, _ = parse_ocr_evidence(raw_text)
    return values


def validate_ocr_report(values: dict[str, int | None]) -> list[ValidationError]:
    """Run the standard validator on OCR-extracted values.

    Identical to the validation path used by web-form and Excel uploads.
    BLANK errors for null OCR values are expected (cells Gemini could not
    read) and are surfaced to the user as cells requiring manual entry.
    """
    return validate_report(values)


async def ocr_report_document_async(document_bytes: bytes) -> OcrPreview:
    """Full image/PDF OCR pipeline for a read-only human-review preview.

    Parameters
    ----------
    document_bytes : bytes
        Raw bytes of a JPEG/PNG photo or raster-scan PDF.

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
    cropped_pages = prepare_ocr_pages(document_bytes)
    known_codes = _load_indicator_codes()
    raw_values: dict[str, int | float | str | None] = {
        code: None for code in known_codes
    }
    values: dict[str, int | None] = {code: None for code in known_codes}
    confidences: dict[str, float] = {code: 0.0 for code in known_codes}
    source_pages: dict[str, int | None] = {code: None for code in known_codes}
    conflict_codes: set[str] = set()
    raw_responses: list[str] = []

    for page_number, cropped in cropped_pages:
        raw_text = await _call_gemini_ocr(cropped)
        raw_responses.append(raw_text)
        page_raw, page_values, page_confidences = parse_ocr_evidence(raw_text)
        for code in known_codes:
            page_value = page_values[code]
            if raw_values[code] is None and page_raw[code] is not None:
                raw_values[code] = page_raw[code]
                source_pages[code] = page_number
            if page_value is None:
                continue
            if values[code] is None and code not in conflict_codes:
                raw_values[code] = page_raw[code]
                values[code] = page_value
                confidences[code] = page_confidences[code]
                source_pages[code] = page_number
            elif values[code] != page_value:
                # Conflicting readings across pages are never resolved by AI.
                raw_values[code] = None
                values[code] = None
                confidences[code] = 0.0
                source_pages[code] = None
                conflict_codes.add(code)

    null_codes = [code for code, val in values.items() if val is None]
    flags: list[dict[str, str]] = list(validate_ocr_report(values))
    flags.extend(
        {
            "ct_code": code,
            "error_type": "OCR_CONFLICT",
            "message": (
                f"{code} có kết quả khác nhau giữa các trang; "
                "cán bộ phải nhập và xác nhận lại."
            ),
        }
        for code in sorted(conflict_codes)
    )

    field_flag_types: dict[str, list[str]] = {code: [] for code in known_codes}
    for flag in flags:
        code = flag["ct_code"]
        if code in field_flag_types:
            field_flag_types[code].append(flag["error_type"])

    evidence: dict[str, OcrFieldEvidence] = {}
    for code in known_codes:
        evidence_flags = list(dict.fromkeys(field_flag_types[code]))
        evidence_flags.append("AI_CONFIDENCE_UNCALIBRATED")
        if values[code] is None and "OCR_CONFLICT" not in evidence_flags:
            readability_flag = (
                "UNREADABLE" if raw_values[code] is None else "UNPARSEABLE"
            )
            if readability_flag not in evidence_flags:
                evidence_flags.append(readability_flag)
        elif (
            confidences[code] < _LOW_CONFIDENCE_THRESHOLD
            and "LOW_CONFIDENCE" not in evidence_flags
        ):
            evidence_flags.append("LOW_CONFIDENCE")
        evidence[code] = OcrFieldEvidence(
            raw_value=raw_values[code],
            normalized_value=values[code],
            confidence=confidences[code],
            source_page=source_pages[code],
            source_region="data_table" if source_pages[code] is not None else None,
            extractor=_OCR_EXTRACTOR,
            method=_OCR_METHOD,
            version=_OCR_VERSION,
            flags=evidence_flags,
            # OCR never bypasses the explicit human-confirmation workflow.
            requires_review=True,
        )

    return OcrPreview(
        values=values,
        raw_values=raw_values,
        flags=flags,
        null_codes=null_codes,
        evidence=evidence,
        raw_gemini_text="\n".join(raw_responses),
    )


async def ocr_report_async(image_bytes: bytes) -> OcrPreview:
    """Backward-compatible image entry point.

    The document-aware pipeline also accepts PDF scans; the old public
    function name remains available for tests and internal callers.
    """
    return await ocr_report_document_async(image_bytes)


def _detect_mime(image_bytes: bytes) -> str:
    """Detect image MIME type from magic bytes."""
    for magic, mime in _MIME_BY_MAGIC.items():
        if image_bytes.startswith(magic):
            return mime
    raise OcrInputError("Unsupported OCR image format")


__all__ = [
    "OcrError",
    "OcrFieldEvidence",
    "OcrInputError",
    "OcrPreview",
    "extract_pdf_scan_pages",
    "extract_table_region",
    "ocr_report_document_async",
    "ocr_report_async",
    "parse_ocr_evidence",
    "parse_ocr_result",
    "prepare_ocr_pages",
    "validate_ocr_report",
]
