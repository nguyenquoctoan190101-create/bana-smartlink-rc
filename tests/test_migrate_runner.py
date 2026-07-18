from __future__ import annotations

import migrate


def test_fresh_database_overlays_exclude_legacy_schema_rewrites() -> None:
    names = [path.name for path in migrate._fresh_overlay_files()]

    assert names
    assert all(name.startswith(("20260715_", "20260718_")) for name in names)
    assert "20260713_0001_security_domain_upgrade.sql" not in names
    assert names[-1] == "20260718_0011_citizen_case_media_storage.sql"
