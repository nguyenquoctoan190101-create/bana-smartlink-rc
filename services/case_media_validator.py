from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import UploadFile


MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_VIDEO_BYTES = 25 * 1024 * 1024
MAX_IMAGE_COUNT = 5
MAX_VIDEO_COUNT = 1
MAX_IMAGE_PIXELS = 25_000_000

_IMAGE_TYPES = {
    ".jpg": ("image/jpeg", b"\xff\xd8\xff"),
    ".jpeg": ("image/jpeg", b"\xff\xd8\xff"),
    ".png": ("image/png", b"\x89PNG\r\n\x1a\n"),
    ".webp": ("image/webp", b"RIFF"),
}
_VIDEO_TYPES = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}


class CaseMediaValidationError(RuntimeError):
    """Raised when citizen media does not meet the safe upload contract."""


async def validate_case_media(upload: UploadFile) -> tuple[bytes, str, str]:
    """Read and validate one attachment before it reaches private storage.

    Video duration is deliberately not inferred from an untrusted client field.
    Until a server-side media probe is installed, video is rejected closed rather
    than silently accepting files longer than the published 30-second limit.
    """
    suffix = Path(upload.filename or "").suffix.casefold()
    if suffix in _VIDEO_TYPES:
        raise CaseMediaValidationError("Video uploads are not enabled until duration validation is available")
    if suffix not in _IMAGE_TYPES:
        raise CaseMediaValidationError("Only JPG, PNG and WebP images are accepted")

    content = await upload.read(MAX_IMAGE_BYTES + 1)
    if not content:
        raise CaseMediaValidationError("Empty attachment")
    if len(content) > MAX_IMAGE_BYTES:
        raise CaseMediaValidationError("Each image must be 8MB or smaller")

    mime_type, magic = _IMAGE_TYPES[suffix]
    if suffix == ".webp":
        if not (content.startswith(magic) and content[8:12] == b"WEBP"):
            raise CaseMediaValidationError("Image content does not match its extension")
    elif not content.startswith(magic):
        raise CaseMediaValidationError("Image content does not match its extension")

    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise CaseMediaValidationError("Image validation is unavailable") from exc

    try:
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                raise CaseMediaValidationError("Image dimensions are not allowed")
            # Decode the complete first frame, apply EXIF orientation, and create a
            # detached pixel copy. Re-encoding below deliberately drops EXIF/XMP,
            # embedded thumbnails and any trailing bytes from the original file.
            image.seek(0)
            image.load()
            sanitized = ImageOps.exif_transpose(image).copy()

        output = BytesIO()
        if mime_type == "image/jpeg":
            if sanitized.mode not in {"RGB", "L"}:
                sanitized = sanitized.convert("RGB")
            sanitized.save(output, format="JPEG", quality=90, optimize=True)
        elif mime_type == "image/png":
            if sanitized.mode not in {"RGB", "RGBA", "L", "LA", "P"}:
                sanitized = sanitized.convert("RGBA")
            sanitized.save(output, format="PNG", optimize=True)
        else:
            if sanitized.mode not in {"RGB", "RGBA"}:
                sanitized = sanitized.convert("RGBA" if "A" in sanitized.getbands() else "RGB")
            sanitized.save(output, format="WEBP", quality=90, method=6)
        content = output.getvalue()
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise CaseMediaValidationError("Sanitized image must be 8MB or smaller")
    except CaseMediaValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise CaseMediaValidationError("Image is corrupt or truncated") from exc

    await upload.seek(0)
    return content, mime_type, suffix.lstrip(".")


__all__ = [
    "CaseMediaValidationError",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_COUNT",
    "MAX_VIDEO_BYTES",
    "MAX_VIDEO_COUNT",
    "validate_case_media",
]
