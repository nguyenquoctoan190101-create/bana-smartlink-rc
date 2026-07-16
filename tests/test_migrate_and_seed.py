from __future__ import annotations

import asyncio
import uuid
from contextlib import AbstractAsyncContextManager
from typing import Any

from scripts import migrate_and_seed


class _Transaction(AbstractAsyncContextManager[None]):
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *args: object) -> None:
        return None


class _Connection:
    def __init__(self, existing_village_id: uuid.UUID) -> None:
        self.existing_village_id = existing_village_id
        self.fetch_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def fetchval(self, query: str, *args: Any) -> uuid.UUID:
        self.fetch_calls.append((query, args))
        return self.existing_village_id

    async def execute(self, query: str, *args: Any) -> str:
        self.execute_calls.append((query, args))
        return "INSERT 0 1"


def test_seed_preserves_existing_village_identity_for_legacy_mapping(monkeypatch) -> None:
    existing_village_id = uuid.uuid4()
    connection = _Connection(existing_village_id)
    monkeypatch.setattr(
        migrate_and_seed,
        "_load_json",
        lambda _path: {
            "_meta": {"mapping_version": "test-v1"},
            "villages_moi": [
                {"id": "thon-moi", "ten": "Thôn Mới", "quy_mo_ho_du_kien": 123}
            ],
            "anh_xa_thon_cu": [
                {
                    "ten_thon_cu": "Thôn Cũ",
                    "new_village_id": "thon-moi",
                    "mapping_status": "confirmed",
                    "legacy_unit_type": "village",
                }
            ],
        },
    )
    monkeypatch.setattr(migrate_and_seed, "_existing_uuid_by_name", lambda: {})

    result = asyncio.run(migrate_and_seed.seed(connection, "ba_na"))

    assert result == (1, 1)
    village_query, village_args = connection.fetch_calls[0]
    assert "on conflict (commune_id, name)" in village_query
    assert "returning id" in village_query
    assert village_args[1:3] == ("ba_na", "Thôn Mới")

    legacy_args = connection.execute_calls[0][1]
    merge_map_args = connection.execute_calls[1][1]
    assert legacy_args[2] == existing_village_id
    assert merge_map_args[1] == existing_village_id
