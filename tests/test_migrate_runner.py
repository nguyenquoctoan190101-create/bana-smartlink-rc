from __future__ import annotations

import asyncio

import pytest

import migrate


def test_fresh_database_overlays_exclude_legacy_schema_rewrites() -> None:
    names = [path.name for path in migrate._fresh_overlay_files()]

    assert names
    assert all(
        name.startswith(
            (
                "20260715_",
                "20260718_",
                "20260722_",
                "20260723_",
                "20260726_",
                "20260727_",
                "20260728_",
                "20260729_",
            )
        )
        for name in names
    )
    assert "20260713_0001_security_domain_upgrade.sql" not in names
    assert names[-1] == "20260729_0031_supabase_advisor_hardening.sql"


def test_runtime_release_overlays_are_narrow_and_ordered() -> None:
    names = [path.name for path in migrate._release_overlay_files()]

    assert names == [
        "20260718_0008_citizen_cases.sql",
        "20260718_0009_knowledge_scenarios.sql",
        "20260718_0010_iot_tourism_pilots.sql",
        "20260718_0011_citizen_case_media_storage.sql",
        "20260718_0012_demo_case_routing.sql",
        "20260722_0013_optional_evacuation_contact_phone.sql",
        "20260722_0014_clear_fake_evacuation_phone.sql",
        "20260723_0015_enforce_report_assistance_provenance.sql",
        "20260723_0016_case_workflow_hardening.sql",
        "20260723_0017_knowledge_access_hardening.sql",
        "20260723_0018_pilot_audit_trail.sql",
        "20260723_0019_report_period_name_guard.sql",
        "20260723_0020_field_synonyms.sql",
        "20260726_0021_report_extraction_audit.sql",
        "20260726_0022_commune_rls_hardening.sql",
        "20260726_0023_release_blocker_hardening.sql",
        "20260726_0024_case_village_scope_hardening.sql",
        "20260726_0025_report_mutation_integrity.sql",
        "20260726_0026_business_workflow_integrity.sql",
        "20260726_0027_report_period_change_approval.sql",
        "20260727_0028_complete_demo_public_reports.sql",
        "20260727_0029_seed_reconciled_sample_reports.sql",
        "20260728_0030_ai_draft_admin_mutation.sql",
        "20260729_0031_supabase_advisor_hardening.sql",
    ]


def test_tracking_table_is_hardened_before_status_or_migration_work() -> None:
    class FakeConnection:
        def __init__(self) -> None:
            self.sql = ""

        async def execute(self, query: str, *args: object) -> None:
            self.sql = query

    connection = FakeConnection()
    asyncio.run(migrate._ensure_tracking(connection))  # type: ignore[arg-type]

    normalized = " ".join(connection.sql.lower().split())
    assert "alter table public.schema_migrations enable row level security" in normalized
    assert "revoke all on table public.schema_migrations from public" in normalized
    for role in ("anon", "authenticated", "service_role"):
        assert f"from {role}" in normalized


def test_failed_migration_rolls_back_before_unlock_without_masking_root_cause(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RootMigrationError(RuntimeError):
        pass

    class CleanupError(RuntimeError):
        pass

    class FakeConnection:
        def __init__(self) -> None:
            self.commands: list[str] = []
            self.in_transaction = False
            self.closed = False

        async def execute(self, query: str, *args: object) -> None:
            normalized = query.strip().lower()
            self.commands.append(normalized)
            if normalized == "rollback":
                self.in_transaction = False
            elif "pg_advisory_unlock" in normalized:
                raise CleanupError("unlock failure must not mask migration failure")

        def is_in_transaction(self) -> bool:
            return self.in_transaction

        async def close(self) -> None:
            self.closed = True

    connection = FakeConnection()

    async def fake_connect(*args: object, **kwargs: object) -> FakeConnection:
        return connection

    async def fake_ensure_tracking(conn: FakeConnection) -> None:
        assert conn is connection

    async def fake_apply(conn: FakeConnection, path: object) -> None:
        assert conn is connection
        conn.in_transaction = True
        raise RootMigrationError("original migration failure")

    monkeypatch.setenv("DATABASE_URL", "postgresql://redacted.invalid/test")
    monkeypatch.setattr(migrate.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(migrate, "_ensure_tracking", fake_ensure_tracking)
    monkeypatch.setattr(migrate, "_apply", fake_apply)
    monkeypatch.setattr(
        migrate,
        "_release_overlay_files",
        lambda: [migrate.MIGRATIONS / "failing.sql"],
    )

    with pytest.raises(RootMigrationError, match="original migration failure"):
        asyncio.run(
            migrate.run(
                baseline=False,
                status_only=False,
                release_overlays=True,
            )
        )

    assert connection.commands.index("rollback") < next(
        index
        for index, command in enumerate(connection.commands)
        if "pg_advisory_unlock" in command
    )
    assert connection.closed is True


def test_migration_cli_reports_only_error_class(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    class RootMigrationError(RuntimeError):
        pass

    async def fail_run(**kwargs: object) -> None:
        raise RootMigrationError("private database response and DSN")

    monkeypatch.setattr(migrate, "run", fail_run)
    monkeypatch.setattr(
        "sys.argv",
        ["migrate.py", "--release-overlays"],
    )

    assert migrate.main() == 1
    output = capsys.readouterr().out
    assert "RootMigrationError" in output
    assert "private database response" not in output
    assert "DSN" not in output


def test_demo_public_backfill_is_guarded_and_complete() -> None:
    migration = (
        migrate.MIGRATIONS / "20260727_0028_complete_demo_public_reports.sql"
    ).read_text(encoding="utf-8")

    assert "template_name = 'demo-synthetic'" in migration
    assert "where not exists" in migration
    assert "publication_status = 'published'" in migration
    assert "Thôn An Sơn" in migration
    assert "Thôn Hòa Ninh" in migration
    for code in ("CT01", "CT02", "CT09", "CT12", "CT13"):
        assert f"'{code}'" in migration
    assert "Thôn Đông Sơn" not in migration


def test_reconciled_sample_reports_are_private_and_fail_closed() -> None:
    migration = (
        migrate.MIGRATIONS / "20260727_0029_seed_reconciled_sample_reports.sql"
    ).read_text(encoding="utf-8")

    assert "template_name = 'demo-synthetic'" in migration
    assert "template_name = 'sample-reconciled'" in migration
    assert "'private'" in migration
    assert "'draft'" in migration
    assert "'published'" not in migration
    assert "SAMPLE_SOURCE_RECONCILIATION" in migration
    assert (
        "caa9178f3c6975a553578e1c69558813dcb72f4e4ba20c65c4910b3b1fb033cb"
        in migration
    )
    assert "Thôn Đông Sơn" in migration
    assert "('CT14', source.ct14)" in migration
