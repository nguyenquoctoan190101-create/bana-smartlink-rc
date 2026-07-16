"""Create a deterministic, allowlisted and secret-scanned release archive."""

from __future__ import annotations

import argparse
import hashlib
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent
ALLOWED_ROOT_FILES = {
    ".dockerignore",
    ".gitignore",
    "Dockerfile",
    "README.md",
    "index.html",
    "main.py",
    "metadata.json",
    "migrate.py",
    "package-lock.json",
    "package.json",
    "pytest.ini",
    "render.yaml",
    "requirements.txt",
    "tsconfig.json",
    "vite.config.ts",
    "vitest.config.ts",
    "zip_project.py",
}
ALLOWED_DIRS = {
    ".github",
    "assets",
    "config",
    "db",
    "docs",
    "DU_LIEU_CHINH_THUC",
    "migrations",
    "public",
    "routers",
    "scripts",
    "services",
    "src",
}
EXCLUDED_PARTS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".venv",
    "venv",
}
EXCLUDED_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".zip",
    ".tar",
    ".gz",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
}
TEXT_SUFFIXES = {
    ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".sql",
    ".svg", ".ts", ".tsx", ".txt", ".yaml", ".yml",
}
TEXT_NAMES = {".dockerignore", "Dockerfile"}
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "credentialed database URL": re.compile(
        r"postgres(?:ql)?://[^\s:/]+:[^\s@/]+@", re.IGNORECASE
    ),
    "service-role JWT": re.compile(
        r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"
    ),
    "provider API key": re.compile(r"AIza[A-Za-z0-9_-]{30,}"),
}


def _is_allowed(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if path.is_symlink() or any(part in EXCLUDED_PARTS for part in relative.parts):
        return False
    if relative.name == ".env" or relative.name.startswith(".env."):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    # The release artifact is deployable source, not a research/archive bundle.
    # Raw contest fixtures can contain PII-like sample data and must never be
    # distributed with an Internet-facing deployment.  Keep only the official,
    # non-personal village reference required by the seed command.
    if relative.parts[0] == "tests":
        return False
    if relative.as_posix().startswith("src/test/") or ".test." in relative.name:
        return False
    if relative.parts[0] == "DU_LIEU_CHINH_THUC":
        return relative.as_posix() == "DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json"
    if len(relative.parts) == 1:
        return relative.name in ALLOWED_ROOT_FILES
    return relative.parts[0] in ALLOWED_DIRS


def _release_files() -> list[Path]:
    files = [path for path in ROOT.rglob("*") if path.is_file() and _is_allowed(path)]
    return sorted(files, key=lambda value: value.relative_to(ROOT).as_posix())


def _scan(path: Path) -> None:
    if path.stat().st_size == 0 and path.suffix.lower() in {".xlsx", ".pdf", ".docx"}:
        raise RuntimeError(f"empty release artifact: {path.relative_to(ROOT)}")
    if (
        path.suffix.lower() not in TEXT_SUFFIXES
        and path.name not in TEXT_NAMES
    ) or path.stat().st_size > 5_000_000:
        return
    text = path.read_text(encoding="utf-8", errors="ignore")
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(text):
            raise RuntimeError(f"possible {label}: {path.relative_to(ROOT)}")


def build(output: Path) -> tuple[int, str]:
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("release output must be outside the source directory")
    files = _release_files()
    if not files:
        raise RuntimeError("allowlist selected no files")
    for path in files:
        _scan(path)

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            name = PurePosixPath(path.relative_to(ROOT).as_posix())
            info = zipfile.ZipInfo(str(name), date_time=(2026, 7, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, path.read_bytes())

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return len(files), digest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        count, digest = build(args.output)
    except Exception as exc:
        print(f"Release packaging failed: {exc}")
        return 1
    print(f"Created {args.output.resolve()} with {count} files")
    print(f"SHA256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
