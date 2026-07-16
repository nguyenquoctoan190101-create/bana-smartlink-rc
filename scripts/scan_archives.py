#!/usr/bin/env python
"""Fail closed on probable secrets in ZIP files, including nested ZIP entries.

The scanner never extracts archives and never prints matched values.  It limits
recursion and byte reads to remain safe when examining untrusted contest
artifacts or CI inputs.
"""
from __future__ import annotations

import argparse
import re
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath


MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 5 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024
MAX_DEPTH = 4
TEXT_SUFFIXES = {".css", ".env", ".html", ".ini", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"}
SECRET_PATTERNS = {
    "credentialed database URL": re.compile(r"postgres(?:ql)?://[^\s:/]+:[^\s@/]+@", re.IGNORECASE),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "JWT-like credential": re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),
    "provider API key": re.compile(r"AIza[A-Za-z0-9_-]{30,}"),
}


def _is_text(name: str) -> bool:
    path = PurePosixPath(name)
    return path.suffix.lower() in TEXT_SUFFIXES or path.name.lower().startswith(".env")


def _find_in_text(raw: bytes) -> list[str]:
    text = raw.decode("utf-8", errors="ignore")
    return [label for label, pattern in SECRET_PATTERNS.items() if pattern.search(text)]


def scan_zip_bytes(raw: bytes, label: str, depth: int = 0) -> list[str]:
    """Return redacted finding labels. A malformed/oversized archive is a finding."""
    if depth > MAX_DEPTH:
        return [f"{label}: nesting depth exceeds {MAX_DEPTH}"]
    if len(raw) > MAX_ARCHIVE_BYTES:
        return [f"{label}: archive exceeds {MAX_ARCHIVE_BYTES // (1024 * 1024)} MiB limit"]
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            entries = archive.infolist()
            declared_size = sum(entry.file_size for entry in entries)
            if declared_size > MAX_TOTAL_UNCOMPRESSED:
                return [f"{label}: declared uncompressed size exceeds safe limit"]
            findings: list[str] = []
            for entry in entries:
                if entry.is_dir():
                    continue
                entry_label = f"{label}:{entry.filename}"
                if entry.file_size > MAX_ENTRY_BYTES:
                    findings.append(f"{entry_label}: entry exceeds scan limit")
                    continue
                try:
                    content = archive.read(entry)
                except (RuntimeError, zipfile.BadZipFile):
                    findings.append(f"{entry_label}: unreadable or encrypted entry")
                    continue
                if entry.filename.lower().endswith(".zip"):
                    findings.extend(scan_zip_bytes(content, entry_label, depth + 1))
                elif _is_text(entry.filename):
                    findings.extend(f"{entry_label}: {kind}" for kind in _find_in_text(content))
            return findings
    except zipfile.BadZipFile:
        return [f"{label}: invalid ZIP archive"]


def scan_path(path: Path) -> list[str]:
    if path.is_file():
        if path.suffix.lower() != ".zip":
            return []
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            return [f"{path}: archive exceeds {MAX_ARCHIVE_BYTES // (1024 * 1024)} MiB limit"]
        return scan_zip_bytes(path.read_bytes(), str(path))
    if path.is_dir():
        findings: list[str] = []
        for archive in sorted(path.rglob("*.zip")):
            findings.extend(scan_path(archive))
        return findings
    return [f"{path}: path does not exist"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args(argv)
    findings = [finding for path in args.paths for finding in scan_path(path)]
    if findings:
        for finding in findings:
            print(f"[FINDING] {finding}")
        return 1
    print("[PASS] archive secret scan: no probable secrets found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
