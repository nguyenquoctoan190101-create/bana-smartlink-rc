from __future__ import annotations

from datetime import UTC, datetime, timedelta

from scripts import (
    backup_restore_smoke,
    performance_smoke,
    production_gate,
    production_sha_smoke,
    staging_release_gate,
)


def test_staging_gate_rejects_primary_or_unmarked_database() -> None:
    primary = "postgresql://db.example.test/production"

    assert not staging_release_gate.is_safe_staging_database_url(primary, primary)
    assert not staging_release_gate.is_safe_staging_database_url(
        "postgresql://db.example.test/bana_production", primary
    )
    assert staging_release_gate.is_safe_staging_database_url(
        "postgresql://db.example.test/bana_staging", primary
    )


def test_restore_target_must_be_distinct_and_explicitly_non_production() -> None:
    source = "postgresql://db.example.test/bana_staging"

    assert not backup_restore_smoke.safe_restore_target(source, source)
    assert not backup_restore_smoke.safe_restore_target(
        "postgresql://db.example.test/bana_production", source
    )
    assert backup_restore_smoke.safe_restore_target(
        "postgresql://db.example.test/bana_restore", source
    )


def test_database_urls_are_mapped_to_libpq_environment_not_command_arguments(
    monkeypatch,
) -> None:
    for variable in (
        "PGHOST",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD",
        "PGPORT",
        "PGSSLMODE",
    ):
        monkeypatch.setenv(variable, "must-not-leak")

    url = "postgresql://operator@db.example.test:6543/bana_staging?sslmode=require"
    environment = staging_release_gate.postgres_environment(url)

    assert environment["PGHOST"] == "db.example.test"
    assert environment["PGDATABASE"] == "bana_staging"
    assert environment["PGUSER"] == "operator"
    assert "PGPASSWORD" not in environment
    assert environment["PGPORT"] == "6543"
    assert environment["PGSSLMODE"] == "require"
    backup_environment = backup_restore_smoke.postgres_environment(url)
    assert backup_environment["PGDATABASE"] == "bana_staging"
    assert "PGPASSWORD" not in backup_environment


def test_database_url_password_replaces_inherited_libpq_password(monkeypatch) -> None:
    monkeypatch.setenv("PGPASSWORD", "inherited-secret")
    expected_password = "url-secret"
    url = "postgresql://" + "operator:" + expected_password + "@db.example.test/bana_restore"

    assert staging_release_gate.postgres_environment(url)["PGPASSWORD"] == expected_password
    assert backup_restore_smoke.postgres_environment(url)["PGPASSWORD"] == expected_password


def test_performance_smoke_rejects_credentialed_or_non_http_origin() -> None:
    assert performance_smoke.safe_base_url("https://api.example.test/") == "https://api.example.test"
    for value in (
        "https://user:password@example.test",
        "https://example.test/path",
        "https://example.test?query=yes",
        "file:///tmp/api",
        "example.test",
    ):
        try:
            performance_smoke.safe_base_url(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe base URL accepted: {value}")


def test_percentile_uses_nearest_rank() -> None:
    assert performance_smoke.percentile([10.0, 20.0, 30.0, 40.0], 95) == 40.0
    assert performance_smoke.percentile([10.0, 20.0, 30.0, 40.0], 50) == 20.0


def test_production_sha_smoke_requires_a_full_exact_commit() -> None:
    commit = "1234567890abcdef1234567890abcdef12345678"

    assert production_sha_smoke.validate_expected_commit(commit.upper()) == commit
    assert production_sha_smoke.validate_health_payload(
        {"status": "ok", "version": commit}, commit
    ) == []
    assert "deployed version does not match" in " ".join(
        production_sha_smoke.validate_health_payload(
            {"status": "ok", "version": commit[:7]}, commit
        )
    )
    for invalid in (commit[:39], f"{commit}0", "not-a-commit"):
        try:
            production_sha_smoke.validate_expected_commit(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid commit accepted: {invalid}")


def _complete_attestation(completed_at: str) -> dict[str, object]:
    return {
        "controls": {
            name: {
                "status": "passed",
                "owner": "release owner",
                "evidence": "ticket://example/123",
                "completed_at": completed_at,
            }
            for name in production_gate.REQUIRED_CONTROLS
        }
    }


def test_production_gate_requires_all_recent_owner_evidence() -> None:
    now = datetime(2026, 7, 14, tzinfo=UTC)
    payload = _complete_attestation("2026-07-10T12:00:00Z")

    assert production_gate.validate_attestations(payload, now) == []
    payload["controls"].pop("uat_five_principals")  # type: ignore[index]
    assert "uat_five_principals: missing" in production_gate.validate_attestations(
        payload, now
    )


def test_production_gate_accepts_legacy_uat_key_during_transition() -> None:
    now = datetime(2026, 7, 14, tzinfo=UTC)
    payload = _complete_attestation("2026-07-10T12:00:00Z")
    controls = payload["controls"]  # type: ignore[assignment]
    controls["uat_four_roles"] = controls.pop("uat_five_principals")  # type: ignore[index]

    assert production_gate.validate_attestations(payload, now) == []


def test_production_gate_rejects_stale_or_naive_timestamp() -> None:
    now = datetime(2026, 7, 14, tzinfo=UTC)
    stale = _complete_attestation((now - timedelta(days=91)).isoformat())
    stale_errors = production_gate.validate_attestations(stale, now)
    assert any("outside the permitted age window" in error for error in stale_errors)

    naive = _complete_attestation("2026-07-10T12:00:00")
    naive_errors = production_gate.validate_attestations(naive, now)
    assert any("timezone-aware" in error for error in naive_errors)
