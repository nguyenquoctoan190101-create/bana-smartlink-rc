from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")


def test_report_domain_has_independent_statuses_and_concurrency_fields() -> None:
    for marker in (
        "report_workflow_status",
        "report_timeliness_status",
        "report_publication_status",
        "version integer not null",
        "idempotency_key uuid",
    ):
        assert marker in SCHEMA


def test_public_projection_is_published_and_excludes_ct14() -> None:
    view = SCHEMA.split("create view public.published_report_summary", 1)[1].split(
        "comment on view public.published_report_summary", 1
    )[0]
    assert "publication_status = 'published'" in view
    assert "'CT01', 'CT02', 'CT09', 'CT12', 'CT13'" in view
    assert "CT14" not in view
    assert "revoke all on public.published_report_summary from anon" in SCHEMA


def test_atomic_rpcs_and_leader_read_only_policy_exist() -> None:
    assert "create function public.create_report_period" in SCHEMA
    assert "create function public.save_report_submission" in SCHEMA
    assert "raise exception 'leadership is read-only'" in SCHEMA
    assert "public.profile_role() = 'admin_xa'" in SCHEMA


def test_citizens_are_not_an_authenticated_role() -> None:
    role_definition = SCHEMA.split("create type public.user_role", 1)[1].split(");", 1)[0]
    assert "'dan'" not in role_definition


def test_operations_tables_are_rls_protected_and_audited() -> None:
    for marker in (
        "alter table public.action_items enable row level security",
        "alter table public.digital_maturity_assessments enable row level security",
        "alter table public.innovation_initiatives enable row level security",
        "alter table public.ai_action_drafts enable row level security",
        "create function public.audit_operations_change",
        "create trigger ai_drafts_audit",
    ):
        assert marker in SCHEMA


def test_ordered_upgrade_chain_is_present() -> None:
    names = [path.name for path in sorted((ROOT / "migrations").glob("*.sql"))]
    assert names == [
        "20260713_0001_security_domain_upgrade.sql",
        "20260713_0002_atomic_workflows.sql",
        "20260714_0003_production_operations.sql",
        "20260715_0004_legacy_batch_import.sql",
        "20260715_0005_report_templates_and_import_privacy.sql",
        "20260715_0006_database_validation_enforcement.sql",
        "20260715_0007_supabase_function_acl_hardening.sql",
        "20260718_0008_citizen_cases.sql",
        "20260718_0009_knowledge_scenarios.sql",
        "20260718_0010_iot_tourism_pilots.sql",
        "20260718_0011_citizen_case_media_storage.sql",
        "20260718_0012_demo_case_routing.sql",
        "20260722_0013_optional_evacuation_contact_phone.sql",
    ]


def test_database_enforces_deterministic_indicator_rules_on_workflow_transition() -> None:
    for marker in (
        "create function public.report_indicator_values_are_valid",
        "create function public.enforce_submitted_report_values",
        "create trigger reports_enforce_indicator_values",
        "ct03 + ct04 <= ct01",
        "ct07 <= ct02",
        "ct11 <= ct02",
    ):
        assert marker in SCHEMA


def test_import_overlay_is_safe_to_reapply_in_database_contract_job() -> None:
    migration = (
        ROOT / "migrations" / "20260715_0004_legacy_batch_import.sql"
    ).read_text(encoding="utf-8")
    assert "create or replace function public.commit_report_import_batch" in migration
    for marker in (
        "proposed_dissolved_into_village_id",
        "review_reason text",
        "Every uploaded file must be reviewed",
        "No complete current-village group is eligible for import",
        "file.review_status = 'accepted'",
        "revoke insert,update,delete on public.report_import_lineage",
        "guard_report_import_file_mutation",
        "Source import evidence is immutable",
    ):
        assert marker in migration
    for policy in (
        "report_import_batches_select_internal",
        "report_import_batches_mutate_admin",
        "report_import_files_select_internal",
        "report_import_files_mutate_admin",
        "report_import_resolutions_select_internal",
        "report_import_resolutions_mutate_admin",
        "report_import_lineage_select_internal",
        "report_import_lineage_insert_admin",
    ):
        assert f"drop policy if exists {policy}" in migration


def test_database_contract_verifies_new_tables_privileges_and_trigger() -> None:
    verification = (ROOT / "tests" / "sql" / "migration_overlay_verify.sql").read_text(
        encoding="utf-8"
    )
    for marker in (
        "report_import_batches",
        "report_import_files",
        "report_import_resolutions",
        "report_import_lineage",
        "template_sha256",
        "reports_enforce_indicator_values",
        "report_import_files_guard",
        "has_function_privilege('anon'",
        "has_table_privilege('authenticated'",
        "proposed_dissolved_into_village_id",
        "review_reason",
    ):
        assert marker in verification


def test_supabase_direct_function_grants_are_explicitly_hardened() -> None:
    migration = (
        ROOT / "migrations" / "20260715_0007_supabase_function_acl_hardening.sql"
    ).read_text(encoding="utf-8")
    assert migration.count("from public, anon, authenticated, service_role") == 4
    assert (
        "grant execute on function public.commit_report_import_batch(uuid) "
        "to authenticated"
    ) in migration.replace("\n", " ")


def test_database_ci_fails_closed_and_rls_fixture_rolls_back() -> None:
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(
        encoding="utf-8"
    )
    rls_matrix = (ROOT / "tests" / "sql" / "rls_matrix.sql").read_text(
        encoding="utf-8"
    )
    assert workflow.count("psql -v ON_ERROR_STOP=1") == 8
    assert "migrations/20260715_*.sql migrations/20260718_*.sql" in workflow
    assert "for migration in migrations/*.sql" not in workflow
    assert rls_matrix.lstrip().startswith("\\set ON_ERROR_STOP on\n\nbegin;")
    assert rls_matrix.rstrip().endswith("rollback;")
