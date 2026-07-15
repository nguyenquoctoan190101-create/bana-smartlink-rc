from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_TEXT_ROOTS = [
    PROJECT_ROOT / "routers",
    PROJECT_ROOT / "services",
    PROJECT_ROOT / "scripts",
    PROJECT_ROOT / "src",
    PROJECT_ROOT / "public",
    PROJECT_ROOT / ".github",
]


def _production_text_files() -> list[Path]:
    suffixes = {".py", ".ts", ".tsx", ".js", ".json", ".yml", ".yaml"}
    return [
        path
        for root in PRODUCTION_TEXT_ROOTS
        if root.exists()
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in suffixes
    ]


def test_release_tree_contains_no_secret_or_nested_build_artifacts() -> None:
    banned_names = {
        ".env",
        ".env.txt",
        "local_supabase.db",
        "BaNaSmartLink5X.zip",
        "server.ts",
    }
    offenders = [path.relative_to(PROJECT_ROOT) for path in PROJECT_ROOT.rglob("*") if path.name in banned_names]
    nested_archives = [path.relative_to(PROJECT_ROOT) for path in PROJECT_ROOT.rglob("*.zip")]

    assert not offenders, offenders
    assert not nested_archives, nested_archives


def test_production_sources_have_no_embedded_credentials_or_personal_paths() -> None:
    patterns = {
        "google_api_key": re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
        "jwt_like_secret": re.compile(r"eyJ[A-Za-z0-9_-]{80,}"),
        "database_password": re.compile(r"postgres(?:ql)?://[^\s:'\"]+:[^\s@'\"]+@"),
        "personal_windows_path": re.compile(r"[A-Za-z]:[/\\]Users[/\\][^/\\]+"),
    }
    offenders: dict[str, list[str]] = {}
    for path in _production_text_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        matched = [name for name, pattern in patterns.items() if pattern.search(text)]
        if matched:
            offenders[str(path.relative_to(PROJECT_ROOT))] = matched

    assert not offenders, offenders


def test_banned_zalo_runtime_is_removed() -> None:
    runtime_files = [
        path
        for path in _production_text_files()
        if "test" not in path.parts and path.name != "AGENTS.md"
    ]
    offenders = [
        str(path.relative_to(PROJECT_ROOT))
        for path in runtime_files
        if re.search(r"\bzalo\b|\bzns\b", path.read_text(encoding="utf-8", errors="replace"), re.IGNORECASE)
    ]

    assert not offenders, offenders

