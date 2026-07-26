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
    ]


def test_release_blocker_overlay_is_atomic_and_removes_forbidden_channel() -> None:
    migration = (
        ROOT / "migrations" / "20260726_0023_release_blocker_hardening.sql"
    ).read_text(encoding="utf-8")
    assert "save_report_submission_with_extraction" in migration
    assert "perform public.record_report_extraction_review" in migration
    assert "check (channel in ('in_app', 'web_push', 'sms'))" in migration
    assert "security invoker" in migration


def test_report_mutations_require_scoped_audited_rpcs() -> None:
    migration = (
        ROOT / "migrations" / "20260726_0025_report_mutation_integrity.sql"
    ).read_text(encoding="utf-8")
    for marker in (
        "create table if not exists public.report_extraction_evidence",
        "original_values_sha256",
        "create or replace function public.save_manual_report_submission",
        "create or replace function public.save_report_submission_with_extraction",
        "create or replace function public.transition_report_workflow",
        "create or replace function public.delete_report_submission",
        "create or replace function public.jsonb_object_length",
        "revoke insert, update, delete on public.reports",
        "revoke insert, update, delete on public.report_values",
        "perform public.record_report_extraction_review",
        "consumed_idempotency_key",
        "and ct14 <= ct01",
        "or target.workflow_status = 'locked'",
        "or target.publication_status = 'published'",
        "version = report.version + 1",
    ):
        assert marker in migration
    assert (
        "grant execute on function public.save_report_submission("
        not in migration
    )
    assert "jsonb_object_length(" not in SCHEMA
    assert "jsonb_object_length(" not in (
        ROOT / "migrations" / "20260713_0002_atomic_workflows.sql"
    ).read_text(encoding="utf-8")
    assert "jsonb_object_length(" not in (
        ROOT / "migrations" / "20260715_0004_legacy_batch_import.sql"
    ).read_text(encoding="utf-8")


def test_public_case_rpc_rejects_villages_outside_the_requested_commune() -> None:
    migration = (
        ROOT / "migrations" / "20260726_0024_case_village_scope_hardening.sql"
    ).read_text(encoding="utf-8")
    function = migration.split(
        "create or replace function public.create_citizen_case", 1
    )[1].split("revoke all on function public.create_citizen_case", 1)[0]
    assert "security definer set search_path = pg_catalog, public" in function
    assert "p_village_id is not null and not exists" in function
    assert "village.id = p_village_id" in function
    assert "village.commune_id = p_commune_id" in function
    assert "village_not_in_commune" in function
    assert "p_privacy_consent is distinct from true" in function
    assert "consent_required" in function
    assert "using errcode = '23514'" in function
    assert (
        "to service_role"
        in migration.split(
            "grant execute on function public.create_citizen_case", 1
        )[1]
    )
    assert ") from public, anon, authenticated, service_role;" in migration
    assignment = migration.split(
        "create or replace function public.assign_citizen_case", 1
    )[1].split("revoke all on function public.assign_citizen_case", 1)[0]
    assert "security definer set search_path = pg_catalog, public" in assignment
    assert "p_assignee_id is not null and not exists" in assignment
    assert "assignee.commune_id = target_case.commune_id" in assignment
    assert "assignee_not_in_commune" in assignment
    assert (
        "revoke select on table public.evacuation_points, public.villages,"
        in migration
    )
    assert "public.village_merge_map from anon" in migration
    assert "public.village_merge_map to service_role" in migration
    evacuation_policy = migration.split(
        "create policy evacuation_points_select", 1
    )[1].split("drop policy if exists villages_select_active", 1)[0]
    assert "to authenticated" in evacuation_policy
    assert "using (public.can_select_village(village_id))" in evacuation_policy
    assert "is_verified" not in evacuation_policy
    village_policy = migration.split(
        "create policy villages_select_active", 1
    )[1].split("drop policy if exists village_merge_map_select", 1)[0]
    assert "to authenticated" in village_policy
    assert "using (public.can_select_village(id))" in village_policy
    merge_policy = migration.split(
        "create policy village_merge_map_select", 1
    )[1].split("commit;", 1)[0]
    assert "to authenticated" in merge_policy
    assert "coalesce(new_village_id, proposed_new_village_id)" in merge_policy


def test_field_synonyms_are_scoped_audited_and_admin_managed() -> None:
    for marker in (
        "create table public.field_synonyms",
        "alter table public.field_synonyms enable row level security",
        "revoke all on table public.field_synonyms from anon",
        "create policy field_synonyms_select_scoped",
        "create policy field_synonyms_manage_admin",
        "create function public.confirm_field_synonym",
        "p_ct_code is null",
        "create trigger field_synonyms_audit",
    ):
        assert marker in SCHEMA


def test_database_enforces_deterministic_indicator_rules_on_workflow_transition() -> None:
    for marker in (
        "create function public.report_indicator_values_are_valid",
        "create function public.enforce_submitted_report_values",
        "create trigger reports_enforce_indicator_values",
        "ct03 + ct04 <= ct01",
        "ct07 <= ct02",
        "ct11 <= ct02",
        "ct14 <= ct01",
    ):
        assert marker in SCHEMA


def test_report_assistance_provenance_is_database_enforced() -> None:
    for marker in (
        "create function public.enforce_report_assistance_provenance",
        "create trigger reports_assistance_provenance",
        "profile.id = auth.uid()",
        "profile.role, nullif(btrim(profile.display_name), '')",
        "old.assisted_member_name",
        "from public, anon, authenticated, service_role",
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
    assert (
        "migrations/20260715_*.sql migrations/20260718_*.sql "
        "migrations/20260722_*.sql migrations/20260723_*.sql"
    ) in workflow
    assert "for migration in migrations/*.sql" not in workflow
    assert rls_matrix.lstrip().startswith("\\set ON_ERROR_STOP on\n\nbegin;")
    assert rls_matrix.rstrip().endswith("rollback;")


def test_citizen_case_staff_scope_rejects_unassigned_village_records() -> None:
    migration = (
        ROOT / "migrations" / "20260723_0016_case_workflow_hardening.sql"
    ).read_text(encoding="utf-8")
    for policy in (
        "citizen_cases_select_internal",
        "case_locations_select_internal",
        "case_media_select_internal",
        "case_history_select_internal",
        "case_assignments_select_internal",
    ):
        policy_sql = migration.split(f"create policy {policy}", 1)[1].split(");", 1)[0]
        assert "village_id is not null" in policy_sql
        assert "can_select_village" in policy_sql
        assert "profile_role() in ('admin_xa', 'lanh_dao')" in policy_sql


def test_pilot_audit_triggers_only_target_tables_with_uuid_ids() -> None:
    pilot_schema = (
        ROOT / "migrations" / "20260718_0010_iot_tourism_pilots.sql"
    ).read_text(encoding="utf-8")
    audit_migration = (
        ROOT / "migrations" / "20260723_0018_pilot_audit_trail.sql"
    ).read_text(encoding="utf-8")
    audited_tables = (
        "sensor_devices",
        "sensor_observations",
        "alert_rules",
        "alerts",
        "alert_deliveries",
        "tourism_places",
        "tourism_content",
    )
    assert "evacuation_points_audit" in audit_migration
    assert "sensor_health_audit" not in audit_migration
    for table in audited_tables:
        table_sql = pilot_schema.split(
            f"create table if not exists public.{table}", 1
        )[1].split(");", 1)[0]
        assert "id uuid primary key" in table_sql
        assert f"{table}_audit" in audit_migration
