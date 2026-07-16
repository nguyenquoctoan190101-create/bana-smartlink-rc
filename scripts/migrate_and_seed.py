"""Seed official village reference data after running ``migrate.py``.

The historical filename is kept for operator compatibility. This command does
not apply schema SQL and never prints connection details.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any

import asyncpg
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_MAP = ROOT / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"
FRONTEND_MAP = ROOT / "src" / "village_merge_map.json"
NAMESPACE = uuid.UUID("7928f45a-f77f-4c5e-8df1-5ca552355c3d")


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected an object in {path.name}")
    return value


def _existing_uuid_by_name() -> dict[str, uuid.UUID]:
    if not FRONTEND_MAP.exists():
        return {}
    data = _load_json(FRONTEND_MAP)
    result: dict[str, uuid.UUID] = {}
    for village in data.get("new_villages", []):
        try:
            result[str(village["name"])] = uuid.UUID(str(village["id"]))
        except (KeyError, TypeError, ValueError):
            continue
    return result


def _village_uuid(slug: str, name: str, known: dict[str, uuid.UUID]) -> uuid.UUID:
    return known.get(name, uuid.uuid5(NAMESPACE, f"village:{slug}"))


def _is_pending(note: str | None) -> bool:
    normalized = (note or "").upper()
    return "CHUA CHAC CHAN" in normalized or "CAN HOI LAI XA" in normalized


async def seed(conn: asyncpg.Connection, commune_id: str) -> tuple[int, int]:
    data = _load_json(OFFICIAL_MAP)
    mapping_version = str(data.get("_meta", {}).get("mapping_version") or "unversioned")
    known = _existing_uuid_by_name()
    village_ids: dict[str, uuid.UUID] = {}

    async with conn.transaction():
        for village in data.get("villages_moi", []):
            slug = str(village["id"])
            name = str(village["ten"])
            village_id = _village_uuid(slug, name, known)
            village_ids[slug] = village_id
            expected_households = village.get("quy_mo_ho_du_kien")
            household_count = (
                {"2026-07": int(expected_households)}
                if expected_households is not None
                else {}
            )
            await conn.execute(
                """
                insert into public.villages (
                  id, commune_id, name, household_count, mapping_status
                ) values ($1, $2, $3, $4::jsonb, 'confirmed')
                on conflict (id) do update set
                  commune_id = excluded.commune_id,
                  name = excluded.name,
                  household_count = excluded.household_count,
                  updated_at = now()
                """,
                village_id,
                commune_id,
                name,
                json.dumps(household_count, ensure_ascii=False),
            )

        for legacy in data.get("anh_xa_thon_cu", []):
            old_name = str(legacy["ten_thon_cu"])
            raw_target_slug = legacy.get("new_village_id")
            target_id = village_ids[str(raw_target_slug)] if raw_target_slug else None
            raw_proposed_slug = legacy.get("proposed_new_village_id")
            proposed_target_id = village_ids[str(raw_proposed_slug)] if raw_proposed_slug else None
            note = legacy.get("ghi_chu")
            status = str(legacy.get("mapping_status") or ("pending_official_decision" if _is_pending(note) else "confirmed"))
            if status == "pending_official_decision":
                target_id = None
            else:
                proposed_target_id = None
            unit_type = str(legacy.get("legacy_unit_type") or "village")
            legacy_id = uuid.uuid5(NAMESPACE, f"legacy:{old_name}")
            await conn.execute(
                """
                insert into public.villages_legacy (
                  id, old_name, dissolved_into_village_id, proposed_dissolved_into_village_id, commune_id,
                  mapping_status, mapping_version, legacy_unit_type, note
                ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                on conflict (old_name) do update set
                  dissolved_into_village_id = excluded.dissolved_into_village_id,
                  proposed_dissolved_into_village_id = excluded.proposed_dissolved_into_village_id,
                  commune_id = excluded.commune_id,
                  mapping_status = excluded.mapping_status,
                  mapping_version = excluded.mapping_version,
                  legacy_unit_type = excluded.legacy_unit_type,
                  note = excluded.note
                """,
                legacy_id,
                old_name,
                target_id,
                proposed_target_id,
                commune_id,
                status,
                mapping_version,
                unit_type,
                note,
            )
            await conn.execute(
                """
                insert into public.village_merge_map (
                  old_village_name, new_village_id, proposed_new_village_id, mapping_status, source_note
                  , mapping_version
                ) values ($1, $2, $3, $4, $5, $6)
                on conflict (old_village_name) do update set
                  new_village_id = excluded.new_village_id,
                  proposed_new_village_id = excluded.proposed_new_village_id,
                  mapping_status = excluded.mapping_status,
                  source_note = excluded.source_note,
                  mapping_version = excluded.mapping_version
                """,
                old_name,
                target_id,
                proposed_target_id,
                status,
                note,
                mapping_version,
            )
    return len(village_ids), len(data.get("anh_xa_thon_cu", []))


async def run() -> int:
    load_dotenv(ROOT / ".env")
    database_url = os.getenv("DATABASE_URL", "").strip()
    commune_id = os.getenv("BANA_COMMUNE_ID", "ba_na").strip()
    if not database_url or not commune_id:
        print("DATABASE_URL and BANA_COMMUNE_ID are required.")
        return 2
    try:
        conn = await asyncpg.connect(database_url, command_timeout=60)
        try:
            villages, mappings = await seed(conn, commune_id)
        finally:
            await conn.close()
    except Exception:
        print("Reference-data seed failed. See secured operator logs.")
        return 1
    print(f"Seeded {villages} current villages and {mappings} historical mappings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
