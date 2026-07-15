#!/usr/bin/env python
"""Create and verify an isolated PostgreSQL backup; restore only with explicit opt-in."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
import urllib.parse
from urllib.parse import unquote
from pathlib import Path


SAFE_DATABASE_MARKERS = ("stage", "staging", "test", "restore", "sandbox")
LIBPQ_CONNECTION_VARIABLES = (
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPORT",
    "PGSSLMODE",
)


def safe_restore_target(value: str, source: str) -> bool:
    if not value or value == source:
        return False
    parsed = urllib.parse.urlparse(value)
    database_name = parsed.path.lstrip("/").lower()
    return parsed.scheme in {"postgres", "postgresql"} and bool(parsed.hostname) and any(
        marker in database_name for marker in SAFE_DATABASE_MARKERS
    )


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def postgres_environment(database_url: str) -> dict[str, str]:
    """Keep a connection URL/password out of pg_dump/pg_restore argv."""
    parsed = urllib.parse.urlparse(database_url)
    environment = os.environ.copy()
    # A restore URL must be self-contained. Inherited libpq variables could
    # otherwise reuse a password or silently redirect the destructive target.
    for variable in LIBPQ_CONNECTION_VARIABLES:
        environment.pop(variable, None)
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


def run(command: list[str], environment: dict[str, str] | None = None) -> bool:
    completed = subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
        env=environment,
    )
    if completed.stdout.strip():
        print(completed.stdout.strip())
    return completed.returncode == 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-url", default=os.getenv("BACKUP_DATABASE_URL", ""))
    parser.add_argument("--restore-url", default=os.getenv("RESTORE_DATABASE_URL", ""))
    parser.add_argument("--restore", action="store_true", help="destructively restore into the isolated restore target")
    parser.add_argument("--i-understand-restore-destroys-target", action="store_true")
    args = parser.parse_args(argv)
    if not args.backup_url:
        parser.error("BACKUP_DATABASE_URL or --backup-url is required")
    if not command_exists("pg_dump") or not command_exists("pg_restore"):
        print("[FAIL] backup tools: pg_dump and pg_restore must be on PATH")
        return 1
    if args.restore and (
        os.getenv("BANA_BACKUP_RESTORE_APPROVED", "") != "YES"
        or not args.i_understand_restore_destroys_target
        or not safe_restore_target(args.restore_url, args.backup_url)
    ):
        print("[FAIL] restore safety: require approval, explicit destructive flag, and a distinct stage/test restore URL")
        return 1

    with tempfile.TemporaryDirectory(prefix="bana-backup-smoke-") as directory:
        archive = Path(directory) / "backup.dump"
        backup_environment = postgres_environment(args.backup_url)
        if not run(["pg_dump", "--format=custom", "--no-owner", "--file", str(archive)], backup_environment):
            print("[FAIL] backup: pg_dump failed")
            return 1
        if not archive.exists() or archive.stat().st_size == 0 or not run(["pg_restore", "--list", str(archive)]):
            print("[FAIL] backup: archive is empty or unreadable")
            return 1
        print("[PASS] backup: custom archive created and listed successfully")
        if args.restore:
            if not run(
                ["pg_restore", "--clean", "--if-exists", "--no-owner", str(archive)],
                postgres_environment(args.restore_url),
            ):
                print("[FAIL] restore: pg_restore failed")
                return 1
            print("[PASS] restore: archive restored to isolated target")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
