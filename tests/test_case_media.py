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


def test_case_media_rejects_video_until_duration_probe_exists() -> None:
    with pytest.raises(CaseMediaValidationError, match="duration"):
        asyncio.run(validate_case_media(_upload("evidence.mp4", b"....ftypmp42")))


def test_case_media_rejects_mismatched_magic_bytes() -> None:
    with pytest.raises(CaseMediaValidationError, match="match"):
        asyncio.run(validate_case_media(_upload("evidence.png", b"not an image")))
