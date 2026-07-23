from __future__ import annotations

import asyncio
from io import BytesIO

import pytest
from fastapi import UploadFile
from PIL import Image

from services.case_media_validator import CaseMediaValidationError, validate_case_media


def _upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content))


def _png() -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), "white").save(output, format="PNG")
    return output.getvalue()


def test_case_media_accepts_valid_png_and_rewinds_stream() -> None:
    upload = _upload("evidence.png", _png())
    content, mime, extension = asyncio.run(validate_case_media(upload))
    assert content.startswith(b"\x89PNG")
    assert mime == "image/png"
    assert extension == "png"
    assert upload.file.tell() == 0


def test_case_media_reencodes_pixels_and_removes_exif() -> None:
    original = BytesIO()
    image = Image.new("RGB", (2, 3), "white")
    exif = image.getexif()
    exif[274] = 6  # Orientation: rotate 90 degrees clockwise.
    exif[315] = "private citizen metadata"
    image.save(original, format="JPEG", exif=exif)

    content, mime, extension = asyncio.run(
        validate_case_media(_upload("evidence.jpg", original.getvalue()))
    )

    assert mime == "image/jpeg"
    assert extension == "jpg"
    assert b"private citizen metadata" not in content
    with Image.open(BytesIO(content)) as sanitized:
        assert sanitized.size == (3, 2)
        assert len(sanitized.getexif()) == 0


def test_case_media_rejects_video_until_duration_probe_exists() -> None:
    with pytest.raises(CaseMediaValidationError, match="duration"):
        asyncio.run(validate_case_media(_upload("evidence.mp4", b"....ftypmp42")))


def test_case_media_rejects_mismatched_magic_bytes() -> None:
    with pytest.raises(CaseMediaValidationError, match="match"):
        asyncio.run(validate_case_media(_upload("evidence.png", b"not an image")))


@pytest.mark.parametrize(
    ("name", "content", "message"),
    [
        ("evidence.txt", b"plain text", "Only JPG"),
        ("empty.png", b"", "Empty"),
        ("broken.webp", b"RIFF0000NOPE", "match"),
        ("broken.jpg", b"\xff\xd8\xffnot-an-image", "corrupt"),
    ],
)
def test_case_media_rejects_other_unsafe_inputs(
    name: str, content: bytes, message: str
) -> None:
    with pytest.raises(CaseMediaValidationError, match=message):
        asyncio.run(validate_case_media(_upload(name, content)))
