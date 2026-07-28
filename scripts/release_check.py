"""Offline release hygiene checks used locally and in CI."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git", ".venv", "venv", "node_modules", "dist", "build",
    "__pycache__", ".pytest_cache", "coverage",
}
TEXT_SUFFIXES = {
    ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".py", ".sql",
    ".svg", ".ts", ".tsx", ".txt", ".yaml", ".yml",
}
TEXT_NAMES = {".dockerignore", "Dockerfile"}
SECRET_PATTERNS = {
    "credentialed database URL": re.compile(
        r"postgres(?:ql)?://[^\s:/]+:[^\s@/]+@", re.IGNORECASE
    ),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "JWT-like credential": re.compile(
        r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"
    ),
    "provider API key": re.compile(r"AIza[A-Za-z0-9_-]{30,}"),
}
ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:[\\/](?:Users|Documents|Downloads)|/Users/|/home/)")
FORBIDDEN_RUNTIME = re.compile(
    r"(?i)(" + "za" + "lo" + r"|firebase|from\s+express|require\(['\"]express)"
)


def files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file() and not any(part in SKIP_DIRS for part in path.parts)
    ]


def main() -> int:
    failures: list[str] = []
    all_files = files()
    for path in all_files:
        relative = path.relative_to(ROOT)
        lower_name = path.name.lower()
        if lower_name == ".env" or (lower_name.startswith(".env.") and lower_name != ".env.example"):
            failures.append(f"local environment file: {relative}")
        if path.suffix.lower() in {".zip", ".tar", ".gz", ".db", ".sqlite", ".sqlite3", ".pyc"}:
            failures.append(f"generated/binary artifact: {relative}")
        if path.stat().st_size == 0 and path.suffix.lower() in {".xlsx", ".pdf", ".docx"}:
            failures.append(f"empty document fixture: {relative}")
        if (
            path.suffix.lower() not in TEXT_SUFFIXES
            and path.name not in TEXT_NAMES
        ) or path.stat().st_size > 5_000_000:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                failures.append(f"{label}: {relative}")
        if relative.as_posix() not in {"AGENTS.md", "scripts/release_check.py"} and ABSOLUTE_PATH.search(text):
            failures.append(f"personal absolute path: {relative}")
        if (
            relative.parts[0] in {"routers", "services", "scripts", ".github"}
            and relative.as_posix() != "scripts/release_check.py"
            and FORBIDDEN_RUNTIME.search(text)
        ):
            failures.append(f"forbidden runtime integration: {relative}")

    lock = ROOT / "package-lock.json"
    if not lock.exists() or lock.stat().st_size == 0:
        failures.append("package-lock.json is missing or empty")

    dockerfile = ROOT / "Dockerfile"
    blueprint = ROOT / "render.yaml"
    if not dockerfile.exists():
        failures.append("Dockerfile is missing")
    else:
        docker_text = dockerfile.read_text(encoding="utf-8")
        for forbidden_arg in ("ARG DATABASE_URL", "ARG SUPABASE_SECRET_KEY"):
            if forbidden_arg in docker_text:
                failures.append(f"secret exposed as Docker build arg: {forbidden_arg}")
    if not blueprint.exists():
        failures.append("render.yaml is missing")
    for json_path in [
        ROOT / "package.json",
        ROOT / "config" / "validation_rules.json",
        ROOT / "config" / "metric_registry.json",
        ROOT / "config" / "field_synonyms.json",
        ROOT / "tests" / "fixtures" / "metric_cases.json",
    ]:
        try:
            json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            failures.append(f"invalid JSON: {json_path.relative_to(ROOT)}")

    schema = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")
    required_schema_markers = [
        "report_workflow_status",
        "report_timeliness_status",
        "report_publication_status",
        "save_report_submission",
        "create_report_period",
        "'CT01', 'CT02', 'CT09', 'CT12', 'CT13'",
    ]
    for marker in required_schema_markers:
        if marker not in schema:
            failures.append(f"canonical schema marker missing: {marker}")

    if failures:
        print("Release check failed:")
        for failure in sorted(set(failures)):
            print(f"- {failure}")
        return 1
    print(f"Release check passed ({len(all_files)} files inspected).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
