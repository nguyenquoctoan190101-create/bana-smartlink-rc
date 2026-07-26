from __future__ import annotations

from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import UploadFile


MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
MAX_XLSX_ENTRIES = 1_000
MAX_COMPRESSION_RATIO = 100
MAX_IMAGE_PIXELS = 25_000_000
MAX_PDF_PAGES = 5
MAX_PDF_OBJECTS = 2_000
ALLOWED_EXTENSIONS = {".xlsx", ".jpg", ".jpeg", ".png", ".pdf"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
PDF_SIGNATURE = b"%PDF-"
ZIP_SIGNATURES = (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")


class UploadValidationError(RuntimeError):
    """Raised when an uploaded report file is not allowed."""


async def validate_report_upload(upload_file: UploadFile) -> bytes:
    """Validate extension, size, and magic bytes for report uploads."""
    suffix = Path(upload_file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise UploadValidationError("Unsupported file type")

    content = await upload_file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise UploadValidationError("Empty file")

    if len(content) > MAX_UPLOAD_BYTES:
        raise UploadValidationError("File is larger than 5MB")

    if not _has_valid_magic_bytes(suffix, content):
        raise UploadValidationError("File content does not match extension")

    if suffix in {".jpg", ".jpeg", ".png"}:
        _validate_image(content)
    elif suffix == ".pdf":
        _validate_pdf(content)

    await upload_file.seek(0)
    return content


def _has_valid_magic_bytes(suffix: str, content: bytes) -> bool:
    if suffix == ".png":
        return content.startswith(PNG_SIGNATURE)

    if suffix in {".jpg", ".jpeg"}:
        return content.startswith(JPEG_SIGNATURE)

    if suffix == ".xlsx":
        return _is_xlsx_workbook(content)

    if suffix == ".pdf":
        return content.startswith(PDF_SIGNATURE)

    return False


def _is_xlsx_workbook(content: bytes) -> bool:
    if not content.startswith(ZIP_SIGNATURES):
        return False

    try:
        with ZipFile(BytesIO(content)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_XLSX_ENTRIES:
                return False
            names = {info.filename for info in infos}
            if len(names) != len(infos):
                # Duplicate package names are interpreted inconsistently by
                # ZIP readers and can make the validated content differ from
                # the content consumed by the spreadsheet parser.
                return False
            total_uncompressed = 0
            for info in infos:
                normalized = info.filename.replace("\\", "/")
                path_parts = normalized.split("/")
                if (
                    info.flag_bits & 0x1
                    or "\x00" in normalized
                    or normalized.startswith("/")
                    or ".." in path_parts
                    or (path_parts and path_parts[0].endswith(":"))
                    or normalized.lower().endswith("vbaproject.bin")
                    or normalized.startswith("xl/externalLinks/")
                ):
                    return False
                total_uncompressed += info.file_size
                if total_uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES:
                    return False
                if info.file_size and info.compress_size == 0:
                    return False
                if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                    return False

            for name in names:
                if name.endswith(".rels"):
                    relationship_xml = archive.read(name)
                    root = ElementTree.fromstring(relationship_xml)
                    for relationship in root.iter():
                        target_mode = relationship.attrib.get("TargetMode", "")
                        target = relationship.attrib.get("Target", "")
                        if target_mode.casefold() == "external":
                            return False
                        parsed_target = urlsplit(target)
                        if parsed_target.scheme or target.startswith("//"):
                            return False
    except (BadZipFile, ElementTree.ParseError, KeyError, OSError, RuntimeError):
        return False

    # XLSX files are ZIP packages with these required workbook parts.
    return "[Content_Types].xml" in names and "xl/workbook.xml" in names


def _validate_image(content: bytes) -> None:
    """Decode the image header and reject bombs/truncated images fail-closed."""
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as exc:
        raise UploadValidationError("Image validation is unavailable") from exc

    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise UploadValidationError("Image dimensions are not allowed")
            image.verify()
    except UploadValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise UploadValidationError("Image is corrupt or truncated") from exc


def _validate_pdf(content: bytes) -> None:
    """Reject active, encrypted, malformed, or excessively complex PDFs.

    OCR accepts PDF as an input container only. The OCR service separately
    extracts and sanitizes raster page images before any external call.
    """
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError as exc:
        raise UploadValidationError("PDF validation is unavailable") from exc

    try:
        reader = PdfReader(BytesIO(content), strict=True)
        if reader.is_encrypted:
            raise UploadValidationError("Không chấp nhận tệp PDF được mã hóa")

        page_count = len(reader.pages)
        if page_count < 1 or page_count > MAX_PDF_PAGES:
            raise UploadValidationError(
                f"Tệp PDF phải có từ 1 đến {MAX_PDF_PAGES} trang"
            )

        xref = getattr(reader, "xref", {})
        object_count = (
            sum(len(objects) for objects in xref.values())
            if isinstance(xref, dict)
            else 0
        )
        if object_count > MAX_PDF_OBJECTS:
            raise UploadValidationError("Tệp PDF có cấu trúc quá phức tạp")

        root = reader.trailer["/Root"].get_object()
        if any(key in root for key in ("/OpenAction", "/AA", "/AcroForm")):
            raise UploadValidationError(
                "Không chấp nhận tệp PDF có nội dung chủ động"
            )

        names_ref = root.get("/Names")
        if names_ref is not None:
            names = names_ref.get_object()
            if any(key in names for key in ("/JavaScript", "/EmbeddedFiles")):
                raise UploadValidationError(
                    "Không chấp nhận tệp PDF có nội dung chủ động"
                )

        for page in reader.pages:
            if any(key in page for key in ("/AA", "/Annots")):
                raise UploadValidationError(
                    "Không chấp nhận tệp PDF có nội dung tương tác"
                )
    except UploadValidationError:
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
        raise UploadValidationError("Tệp PDF bị lỗi hoặc không hợp lệ") from exc


__all__ = [
    "MAX_UPLOAD_BYTES",
    "UploadValidationError",
    "validate_report_upload",
]
