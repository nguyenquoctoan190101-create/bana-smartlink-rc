#!/usr/bin/env python
"""Run the executable, non-production gates required before a staging release.

This command deliberately refuses to use ``DATABASE_URL``.  An operator must
provide a separately named ``STAGING_DATABASE_URL`` and opt in twice before the
RLS SQL matrix is allowed to insert its test identities and reports.  The
command does not print either URL.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import urllib.parse
from urllib.parse import unquote
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RLS_BOOTSTRAP = ROOT / "tests" / "sql" / "supabase_test_bootstrap.sql"
RLS_MATRIX = ROOT / "tests" / "sql" / "rls_matrix.sql"
SCHEMA = ROOT / "db" / "schema.sql"
SAFE_DATABASE_MARKERS = ("stage", "staging", "test", "restore", "sandbox")


def _result(name: str, passed: bool, detail: str) -> None:
    print(f"[{'PASS' if passed else 'FAIL'}] {name}: {detail}")


def is_safe_staging_database_url(value: str, primary_database_url: str = "") -> bool:
    """Accept only an explicit non-production PostgreSQL URL without a path trick."""
    if not value or value == primary_database_url:
        return False
    parsed = urllib.parse.urlparse(value)
    database_name = parsed.path.lstrip("/").lower()
    return (
        parsed.scheme in {"postgres", "postgresql"}
        and bool(parsed.hostname)
        and any(marker in database_name for marker in SAFE_DATABASE_MARKERS)
    )


def postgres_environment(database_url: str) -> dict[str, str]:
    """Convert a libpq URL into environment variables, keeping it out of argv."""
    parsed = urllib.parse.urlparse(database_url)
    environment = os.environ.copy()
    environment["PGHOST"] = parsed.hostname or ""
    environment["PGDATABASE"] = unquote(parsed.path.lstrip("/"))
    if parsed.username:
        environment["PGUSER"] = unquote(parsed.username)
    if parsed.password:
        environment["PGPASSWORD"] = unquote(parsed.password)
    if parsed.port:
        environment["PGPORT"] = str(parsed.port)
    for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=False):
        if key == "sslmode":
            environment["PGSSLMODE"] = value
    return environment


def run_psql(database_url: str, sql_file: Path) -> bool:
    """Execute a versioned SQL file without exposing the DSN to command output."""
    psql = shutil.which("psql")
    if not psql:
        _result(sql_file.name, False, "psql is not available on PATH")
        return False
    completed = subprocess.run(
        [psql, "--no-password", "--set", "ON_ERROR_STOP=1", "--file", str(sql_file)],
        cwd=ROOT,
        env=postgres_environment(database_url),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if completed.stdout.strip():
        # psql output contains SQL results, never the DSN. Keep it useful for operators.
        print(completed.stdout.strip())
    passed = completed.returncode == 0
    _result(sql_file.name, passed, f"psql exit {completed.returncode}")
    return passed


def run_rls_matrix(database_url: str) -> bool:
    """Bootstrap a disposable staging DB, migrate it, then run the real RLS matrix."""
    return all(
        run_psql(database_url, sql_file)
        for sql_file in (RLS_BOOTSTRAP, SCHEMA, RLS_MATRIX)
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.getenv("BANA_API_BASE_URL", ""))
    parser.add_argument("--run-rls", action="store_true", help="run mutating SQL only on an isolated staging DB")
    parser.add_argument("--skip-pre-demo", action="store_true")
    args = parser.parse_args(argv)

    results: list[bool] = []
    if not args.skip_pre_demo:
        command = [sys.executable, "scripts/pre_demo_check.py"]
        if args.base_url:
            command.extend(["--base-url", args.base_url])
        completed = subprocess.run(command, cwd=ROOT, check=False)
        results.append(completed.returncode == 0)
        _result("pre-demo gate", completed.returncode == 0, f"exit {completed.returncode}")

    if args.run_rls:
        database_url = os.getenv("STAGING_DATABASE_URL", "").strip()
        primary_database_url = os.getenv("DATABASE_URL", "").strip()
        approved = os.getenv("BANA_STAGING_RLS_APPROVED", "") == "YES"
        safe = is_safe_staging_database_url(database_url, primary_database_url)
        if not approved:
            _result("RLS safety approval", False, "set BANA_STAGING_RLS_APPROVED=YES after selecting an isolated DB")
            results.append(False)
        elif not safe:
            _result("RLS target", False, "STAGING_DATABASE_URL must be a distinct PostgreSQL DB named stage/test/restore/sandbox")
            results.append(False)
        else:
            results.append(run_rls_matrix(database_url))

    if not results:
        _result("staging release", False, "no gate selected")
        return 2
    passed = all(results)
    _result("staging release", passed, f"{sum(results)}/{len(results)} gates passed")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
