from __future__ import annotations

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from scripts.scan_archives import scan_zip_bytes


def _zip(entries: dict[str, bytes]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_nested_archive_secret_scan_reports_location_but_not_secret_value() -> None:
    token = "eyJ" + "a" * 24 + "." + "b" * 24 + "." + "c" * 24
    nested = _zip({".env": f"TOKEN={token}".encode()})
    findings = scan_zip_bytes(_zip({"nested.zip": nested}), "source.zip")
    assert findings == ["source.zip:nested.zip:.env: JWT-like credential"]
    assert token not in "\n".join(findings)


def test_archive_secret_scan_accepts_clean_text() -> None:
    assert scan_zip_bytes(_zip({"README.md": b"No credential is present."}), "clean.zip") == []
