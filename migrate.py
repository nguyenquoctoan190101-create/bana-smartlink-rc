"""Apply the BaNa SmartLink baseline or ordered upgrade migrations safely."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
from pathlib import Path

import asyncpg
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent
BASELINE = ROOT / "db" / "schema.sql"
MIGRATIONS = ROOT / "migrations"
LOCK_KEY = 7_202_607_13
BASELINE_INCORPORATED_GLOB = "20260713_*.sql"
FRESH_OVERLAY_GLOBS = (
    "20260715_*.sql",
    "20260718_*.sql",
    "20260722_*.sql",
    "20260723_*.sql",
    "20260726_*.sql",
    "20260727_*.sql",
)
RELEASE_OVERLAY_GLOBS = (
    "20260718_*.sql",
    "20260722_*.sql",
    "20260723_*.sql",
    "20260726_*.sql",
    "20260727_*.sql",
)


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def _ensure_tracking(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        create table if not exists public.schema_migrations (
          name text primary key,
          sha256 text not null,
          applied_at timestamptz not null default now()
        )
        """
    )


async def _already_applied(conn: asyncpg.Connection, path: Path) -> bool:
    row = await conn.fetchrow(
        "select sha256 from public.schema_migrations where name = $1", path.name
    )
    if row is None:
        return False
    if row["sha256"] != _checksum(path):
        raise RuntimeError(f"Checksum changed after migration was applied: {path.name}")
    return True


async def _record(conn: asyncpg.Connection, path: Path) -> None:
    await conn.execute(
        """
        insert into public.schema_migrations (name, sha256)
        values ($1, $2)
        on conflict (name) do nothing
        """,
        path.name,
        _checksum(path),
    )


def _fresh_overlay_files() -> list[Path]:
    """Return upgrades that are intentionally safe after the canonical baseline."""
    return sorted(
        {
            path
            for pattern in FRESH_OVERLAY_GLOBS
            for path in MIGRATIONS.glob(pattern)
        }
    )


def _release_overlay_files() -> list[Path]:
    """Return only the idempotent overlays owned by the current RC release."""
    return sorted(
        {
            path
            for pattern in RELEASE_OVERLAY_GLOBS
            for path in MIGRATIONS.glob(pattern)
        }
    )


async def _apply(conn: asyncpg.Connection, path: Path) -> None:
    if await _already_applied(conn, path):
        print(f"SKIP {path.name}")
        return
    print(f"APPLY {path.name}")
    await conn.execute(path.read_text(encoding="utf-8"))
    await _record(conn, path)


async def _assert_empty_database(conn: asyncpg.Connection) -> None:
    tables = await conn.fetchval(
        """
        select count(*)
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name <> 'schema_migrations'
        """
    )
    if tables:
        raise RuntimeError(
            "Baseline is only for an empty database; use ordered migrations for an upgrade"
        )


async def run(
    *,
    baseline: bool,
    status_only: bool,
    release_overlays: bool = False,
) -> None:
    load_dotenv(ROOT / ".env")
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    conn = await asyncpg.connect(database_url, command_timeout=120)
    try:
        await conn.execute("select pg_advisory_lock($1)", LOCK_KEY)
        await _ensure_tracking(conn)
        if status_only:
            if baseline:
                files = [BASELINE, *sorted(MIGRATIONS.glob("*.sql"))]
            elif release_overlays:
                files = _release_overlay_files()
            else:
                files = sorted(MIGRATIONS.glob("*.sql"))
            applied = {
                row["name"]: row["sha256"]
                for row in await conn.fetch(
                    "select name, sha256 from public.schema_migrations order by name"
                )
            }
            for path in files:
                state = "applied" if applied.get(path.name) == _checksum(path) else "pending"
                print(f"{state:7} {path.name}")
            return
        if release_overlays:
            files = _release_overlay_files()
        elif baseline:
            await _assert_empty_database(conn)
            # The baseline already incorporates the 20260713 legacy upgrade.
            # Record those checksums without replaying schema-altering SQL over
            # the modern baseline, then apply only overlays proven safe there.
            await _apply(conn, BASELINE)
            for incorporated in sorted(MIGRATIONS.glob(BASELINE_INCORPORATED_GLOB)):
                print(f"BASELINE {incorporated.name}")
                await _record(conn, incorporated)
            files = _fresh_overlay_files()
        else:
            files = sorted(MIGRATIONS.glob("*.sql"))
        for path in files:
            await _apply(conn, path)
    finally:
        try:
            await conn.execute("select pg_advisory_unlock($1)", LOCK_KEY)
        finally:
            await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--baseline", action="store_true", help="initialize an empty database"
    )
    parser.add_argument(
        "--release-overlays",
        action="store_true",
        help="apply only migrations owned by the current release candidate",
    )
    parser.add_argument("--status", action="store_true", help="show migration state")
    args = parser.parse_args()
    if args.baseline and args.release_overlays:
        parser.error("--baseline and --release-overlays are mutually exclusive")
    try:
        asyncio.run(
            run(
                baseline=args.baseline,
                status_only=args.status,
                release_overlays=args.release_overlays,
            )
        )
    except Exception as exc:  # Never echo a DSN or full driver error.
        print(f"Migration failed ({type(exc).__name__}). See secured server logs.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
