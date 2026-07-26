"""Create a deterministic, allowlisted and secret-scanned release archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parent
RELEASE_BRANCH = "main"
RELEASE_MANIFEST_NAME = "RELEASE_MANIFEST.json"
RELEASE_TAG_PATTERN = re.compile(r"v\d+\.\d+\.\d+(?:-rc\.\d+)?")
ARCHIVE_TIMESTAMP = (2026, 7, 13, 0, 0, 0)
ALLOWED_ROOT_FILES = {
    ".dockerignore",
    ".env.example",
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
    "requirements-dev.txt",
    "requirements-prod.txt",
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
TEXT_NAMES = {".dockerignore", ".env.example", "Dockerfile"}
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
    if relative.name == ".env" or (
        relative.name.startswith(".env.") and relative.name != ".env.example"
    ):
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


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def _verify_release_state() -> str:
    try:
        repository_root = Path(_git("rev-parse", "--show-toplevel")).resolve()
        branch = _git("branch", "--show-current")
        commit = _git("rev-parse", "HEAD")
        remote_commit = _git("rev-parse", f"origin/{RELEASE_BRANCH}")
        status = _git("status", "--porcelain", "--untracked-files=all")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("cannot verify the Git release state") from exc
    if repository_root != ROOT:
        raise RuntimeError("release must run from the Ba Na SmartLink repository root")
    if branch != RELEASE_BRANCH:
        raise RuntimeError(f"release branch must be {RELEASE_BRANCH!r}, found {branch!r}")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise RuntimeError("Git HEAD is not a full 40-character commit SHA")
    if commit != remote_commit:
        raise RuntimeError(f"HEAD must match origin/{RELEASE_BRANCH} before packaging")
    if status:
        raise RuntimeError("working tree must be clean before release packaging")
    return commit


def _verify_release_tag(source_commit: str) -> str:
    """Require one release tag to point at the exact source commit."""

    try:
        rows = _git(
            "for-each-ref",
            "--points-at",
            source_commit,
            "--format=%(refname:strip=2)",
            "refs/tags",
        ).splitlines()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("cannot verify the Git release tag") from exc
    tags = sorted(tag for tag in rows if RELEASE_TAG_PATTERN.fullmatch(tag))
    if not tags:
        raise RuntimeError(
            "release commit must have a version tag such as v1.0.0-rc.2"
        )
    if len(tags) > 1:
        raise RuntimeError(
            "release commit must have exactly one matching version tag; "
            f"found {', '.join(tags)}"
        )
    return tags[0]


def _manifest(files: list[Path], source_commit: str, source_tag: str) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise ValueError("source_commit must be a full lowercase Git commit SHA")
    if not RELEASE_TAG_PATTERN.fullmatch(source_tag):
        raise ValueError("source_tag must be a supported version tag")
    payload = {
        "schema_version": 2,
        "project": "Ba Na SmartLink",
        "source": {
            "branch": RELEASE_BRANCH,
            "commit": source_commit,
            "tag": source_tag,
            "source_of_truth": "GitHub main",
        },
        "archive": {
            "format": "zip",
            "deterministic": True,
            "entry_timestamp": "2026-07-13T00:00:00Z",
            "manifest_self_hash": "not-applicable",
        },
        "files": [
            {
                "path": path.relative_to(ROOT).as_posix(),
                "size": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            for path in files
        ],
    }
    return (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _write_entry(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=ARCHIVE_TIMESTAMP)
    # Stored entries avoid zlib-version differences, so identical source bytes
    # produce an identical archive on Windows and Linux.
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    archive.writestr(info, content)


def build(
    output: Path,
    *,
    source_commit: str,
    source_tag: str,
) -> tuple[int, str]:
    output = output.resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("release output must be outside the source directory")
    if output.suffix.lower() != ".zip":
        raise ValueError("release output must use the .zip extension")
    files = _release_files()
    if not files:
        raise RuntimeError("allowlist selected no files")
    for path in files:
        _scan(path)
    manifest = _manifest(files, source_commit, source_tag)

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        _write_entry(archive, RELEASE_MANIFEST_NAME, manifest)
        for path in files:
            name = PurePosixPath(path.relative_to(ROOT).as_posix())
            _write_entry(archive, str(name), path.read_bytes())

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum_path = output.with_suffix(output.suffix + ".sha256")
    checksum_path.write_text(f"{digest}  {output.name}\n", encoding="ascii")
    return len(files), digest


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Create one deterministic release ZIP and its SHA-256 sidecar from "
            "a clean main checkout."
        )
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        commit = _verify_release_state()
        tag = _verify_release_tag(commit)
        output = args.output.resolve()
        other_archives = [
            path
            for path in output.parent.glob("*.zip")
            if path.resolve() != output and path.is_file()
        ]
        if other_archives:
            raise RuntimeError(
                "release directory must not contain another ZIP; use a new empty directory"
            )
        count, digest = build(
            output,
            source_commit=commit,
            source_tag=tag,
        )
    except Exception as exc:
        print(f"Release packaging failed: {exc}")
        return 1
    print(f"Created {args.output.resolve()} with {count} files")
    print(f"Source {tag} main@{commit}")
    print(f"SHA256 {digest}")
    print(f"Checksum {args.output.resolve().with_suffix(args.output.suffix + '.sha256')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
