\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-00000000a002'),
  ('00000000-0000-4000-8000-00000000a003'),
  ('00000000-0000-4000-8000-00000000a004'),
  ('00000000-0000-4000-8000-00000000a005'),
  ('00000000-0000-4000-8000-00000000a006');

insert into public.villages (id, commune_id, name) values
  ('00000000-0000-4000-8000-00000000c001', 'ba_na', 'Thôn kiểm thử 1'),
  ('00000000-0000-4000-8000-00000000c002', 'ba_na', 'Thôn kiểm thử 2'),
  ('00000000-0000-4000-8000-00000000c003', 'commune_other', 'Thôn xã khác');

insert into public.user_profiles
  (id, commune_id, display_name, role, village_id, is_active, force_password_reset)
values
  ('00000000-0000-4000-8000-00000000a001', 'ba_na', 'Admin', 'admin_xa', null, true, false),
  ('00000000-0000-4000-8000-00000000a002', 'ba_na', 'Cán bộ', 'can_bo_thon', '00000000-0000-4000-8000-00000000c001', true, false),
  ('00000000-0000-4000-8000-00000000a003', 'ba_na', 'CNSCĐ', 'to_cnscd', null, true, false),
  ('00000000-0000-4000-8000-00000000a004', 'ba_na', 'Lãnh đạo', 'lanh_dao', null, true, false),
  ('00000000-0000-4000-8000-00000000a005', 'ba_na', 'Buộc đổi mật khẩu', 'can_bo_thon', '00000000-0000-4000-8000-00000000c002', true, true),
  ('00000000-0000-4000-8000-00000000a006', 'commune_other', 'Quản trị xã khác', 'admin_xa', null, true, false);

insert into public.user_village_assignments (user_id, village_id, assigned_by)
values (
  '00000000-0000-4000-8000-00000000a003',
  '00000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000a001'
);

insert into public.report_periods (id, commune_id, name, due_date, created_by)
values
  (
    '00000000-0000-4000-8000-00000000d001',
    'ba_na',
    'Kỳ kiểm thử RLS',
    '2026-07-17T17:00:00+07:00',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '00000000-0000-4000-8000-00000000d002',
    'commune_other',
    'Kỳ xã khác',
    '2026-07-17T17:00:00+07:00',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.report_period_villages (period_id, village_id) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c001'),
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000c002'),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000c003');

insert into public.reports (
  id, village_id, period_id, workflow_status, timeliness_status,
  publication_status, report_source, created_by, submitted_by,
  approved_by, published_by, submitted_at, approved_at, published_at
) values
  (
    '00000000-0000-4000-8000-00000000b001',
    '00000000-0000-4000-8000-00000000c001',
    '00000000-0000-4000-8000-00000000d001',
    'draft', 'not_submitted', 'private', 'manual',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a001',
    null, null, null
  ),
  (
    '00000000-0000-4000-8000-00000000b002',
    '00000000-0000-4000-8000-00000000c002',
    '00000000-0000-4000-8000-00000000d001',
    'draft', 'not_submitted', 'private', 'manual',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a003',
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a001',
    null, null, null
  ),
  (
    '00000000-0000-4000-8000-00000000b003',
    '00000000-0000-4000-8000-00000000c003',
    '00000000-0000-4000-8000-00000000d002',
    'draft', 'not_submitted', 'private', 'manual',
    '00000000-0000-4000-8000-00000000a006',
    '00000000-0000-4000-8000-00000000a006',
    '00000000-0000-4000-8000-00000000a006',
    '00000000-0000-4000-8000-00000000a006',
    null, null, null
  );

insert into public.report_values (report_id, ct_code, value)
select report_id, ct_code, value
from (
  values
    ('00000000-0000-4000-8000-00000000b001'::uuid, 10),
    ('00000000-0000-4000-8000-00000000b002'::uuid, 20),
    ('00000000-0000-4000-8000-00000000b003'::uuid, 30)
) as report(report_id, households)
cross join lateral (
  values
    ('CT01', households), ('CT02', households * 4),
    ('CT03', 1), ('CT04', 1), ('CT05', 1), ('CT06', 1),
    ('CT07', households), ('CT08', 1), ('CT09', households - 1),
    ('CT10', households * 2), ('CT11', households * 3),
    ('CT12', 6), ('CT13', 2), ('CT14', 1)
) as indicator(ct_code, value);

update public.reports
set workflow_status = 'approved', timeliness_status = 'on_time',
    publication_status = 'published', submitted_at = now(),
    approved_at = now(), published_at = now();

insert into public.pending_updates (
  id, report_id, ct_code, proposed_value, submitter_name, submitter_phone,
  submitter_address, consent_given, consent_version, consent_at, tracking_code
) values
  (
    '00000000-0000-4000-8000-00000000e001',
    '00000000-0000-4000-8000-00000000b001',
    'CT01', 11, 'Người gửi Bà Nà', '0900000001', 'Địa chỉ Bà Nà',
    true, 'rls-test', now(), 'BANARLSTEST00001'
  ),
  (
    '00000000-0000-4000-8000-00000000e002',
    '00000000-0000-4000-8000-00000000b003',
    'CT01', 31, 'Người gửi xã khác', '0900000002', 'Địa chỉ xã khác',
    true, 'rls-test', now(), 'OTHERCOMMUNE0001'
  );

insert into public.audit_log (
  id, action, table_name, record_id, user_id, details
) values
  (
    '00000000-0000-4000-8000-00000000f001',
    'RLS_TEST', 'reports', '00000000-0000-4000-8000-00000000b001',
    '00000000-0000-4000-8000-00000000a001', '{"scope":"ba_na"}'
  ),
  (
    '00000000-0000-4000-8000-00000000f002',
    'RLS_TEST', 'reports', '00000000-0000-4000-8000-00000000b003',
    '00000000-0000-4000-8000-00000000a006', '{"scope":"commune_other"}'
  );

insert into public.action_items (
  id, commune_id, title, created_by
) values
  (
    '10000000-0000-4000-8000-00000000f001',
    'ba_na', 'Việc Bà Nà', '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '10000000-0000-4000-8000-00000000f002',
    'commune_other', 'Việc xã khác', '00000000-0000-4000-8000-00000000a006'
  );

insert into public.citizen_cases (
  id, commune_id, village_id, category, description, consent_version,
  consent_at, tracking_code_hash
) values
  (
    '20000000-0000-4000-8000-00000000c001',
    'ba_na', '00000000-0000-4000-8000-00000000c001',
    'road', 'RLS citizen case for Ba Na commune.', 'rls-test', now(),
    repeat('1', 64)
  ),
  (
    '20000000-0000-4000-8000-00000000c002',
    'commune_other', '00000000-0000-4000-8000-00000000c003',
    'road', 'RLS citizen case for the other commune.', 'rls-test', now(),
    repeat('2', 64)
  );

insert into public.case_locations (
  case_id, latitude, longitude, accuracy_m, source, confirmed_by_submitter
) values
  (
    '20000000-0000-4000-8000-00000000c001',
    16.000001, 108.000001, 5, 'gps', true
  ),
  (
    '20000000-0000-4000-8000-00000000c002',
    16.100001, 108.100001, 5, 'gps', true
  );

insert into public.case_media (
  id, case_id, storage_path, sha256, mime_type, size_bytes, moderation_status
) values
  (
    '20000000-0000-4000-8000-00000000c011',
    '20000000-0000-4000-8000-00000000c001',
    'ba_na/rls/case-1.jpg', repeat('3', 64), 'image/jpeg', 1024, 'approved'
  ),
  (
    '20000000-0000-4000-8000-00000000c012',
    '20000000-0000-4000-8000-00000000c002',
    'commune_other/rls/case-2.jpg', repeat('4', 64), 'image/jpeg', 1024, 'approved'
  );

insert into public.case_assignments (
  id, case_id, department, assignee_id, assigned_by
) values
  (
    '20000000-0000-4000-8000-00000000c021',
    '20000000-0000-4000-8000-00000000c001',
    'Ba Na test department',
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '20000000-0000-4000-8000-00000000c022',
    '20000000-0000-4000-8000-00000000c002',
    'Other commune test department',
    '00000000-0000-4000-8000-00000000a006',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.digital_champions (
  id, commune_id, user_id, village_id, skills, created_by
) values
  (
    '30000000-0000-4000-8000-00000000d001',
    'ba_na', '00000000-0000-4000-8000-00000000a003',
    '00000000-0000-4000-8000-00000000c002',
    '["digital_support"]'::jsonb,
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d002',
    'commune_other', '00000000-0000-4000-8000-00000000a006',
    '00000000-0000-4000-8000-00000000c003',
    '["digital_support"]'::jsonb,
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.community_support_points (
  id, commune_id, village_id, name, address, equipment, champion_id, created_by
) values
  (
    '30000000-0000-4000-8000-00000000d011',
    'ba_na', '00000000-0000-4000-8000-00000000c002',
    'Ba Na support point', 'RLS test address',
    '["computer"]'::jsonb, '30000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d012',
    'commune_other', '00000000-0000-4000-8000-00000000c003',
    'Other commune support point', 'RLS test address',
    '["computer"]'::jsonb, '30000000-0000-4000-8000-00000000d002',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.knowledge_articles (
  id, commune_id, title, body, category, audience, status,
  approved_by, approved_at, created_by
) values
  (
    '30000000-0000-4000-8000-00000000d021',
    'ba_na', 'Ba Na guidance', 'RLS test article body.',
    'guidance', 'internal', 'approved',
    '00000000-0000-4000-8000-00000000a001', now(),
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d022',
    'commune_other', 'Other commune guidance', 'RLS test article body.',
    'guidance', 'internal', 'approved',
    '00000000-0000-4000-8000-00000000a006', now(),
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.knowledge_revisions (
  id, article_id, version, title, body, changed_by
) values
  (
    '30000000-0000-4000-8000-00000000d031',
    '30000000-0000-4000-8000-00000000d021',
    1, 'Ba Na guidance', 'RLS test revision body.',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d032',
    '30000000-0000-4000-8000-00000000d022',
    1, 'Other commune guidance', 'RLS test revision body.',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.scenarios (
  id, commune_id, name, description, created_by
) values
  (
    '30000000-0000-4000-8000-00000000d041',
    'ba_na', 'Ba Na scenario', 'RLS test scenario.',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d042',
    'commune_other', 'Other commune scenario', 'RLS test scenario.',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.scenario_assumptions (
  id, scenario_id, key, value, source_note
) values
  (
    '30000000-0000-4000-8000-00000000d051',
    '30000000-0000-4000-8000-00000000d041',
    'population_change_pct', 1, 'Ba Na RLS test'
  ),
  (
    '30000000-0000-4000-8000-00000000d052',
    '30000000-0000-4000-8000-00000000d042',
    'population_change_pct', 2, 'Other commune RLS test'
  );

insert into public.scenario_runs (
  id, scenario_id, commune_id, baseline, assumptions, result,
  formula_version, created_by
) values
  (
    '30000000-0000-4000-8000-00000000d061',
    '30000000-0000-4000-8000-00000000d041', 'ba_na',
    '{}'::jsonb, '{"population_change_pct":1}'::jsonb, '{}'::jsonb,
    'rls-v1', '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '30000000-0000-4000-8000-00000000d062',
    '30000000-0000-4000-8000-00000000d042', 'commune_other',
    '{}'::jsonb, '{"population_change_pct":2}'::jsonb, '{}'::jsonb,
    'rls-v1', '00000000-0000-4000-8000-00000000a006'
  );

insert into public.sensor_devices (
  id, commune_id, name, device_type, unit, calibration_status, created_by
) values
  (
    '40000000-0000-4000-8000-00000000e001',
    'ba_na', 'Ba Na sensor', 'rain_gauge', 'mm', 'valid',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '40000000-0000-4000-8000-00000000e002',
    'commune_other', 'Other commune sensor', 'rain_gauge', 'mm', 'valid',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.sensor_observations (
  id, device_id, observed_at, value, unit, quality_flag, source_message_id
) values
  (
    '40000000-0000-4000-8000-00000000e011',
    '40000000-0000-4000-8000-00000000e001',
    '2026-07-26T00:00:00+07:00', 10, 'mm', 'good', 'rls-ba-na'
  ),
  (
    '40000000-0000-4000-8000-00000000e012',
    '40000000-0000-4000-8000-00000000e002',
    '2026-07-26T00:00:00+07:00', 20, 'mm', 'good', 'rls-other'
  );

insert into public.sensor_health (
  device_id, battery_pct, signal_strength, checked_at
) values
  ('40000000-0000-4000-8000-00000000e001', 90, -50, now()),
  ('40000000-0000-4000-8000-00000000e002', 80, -60, now());

insert into public.alert_rules (
  id, commune_id, name, device_type, threshold, comparator, created_by
) values
  (
    '40000000-0000-4000-8000-00000000e021',
    'ba_na', 'Ba Na threshold', 'rain_gauge', 100, 'gte',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '40000000-0000-4000-8000-00000000e022',
    'commune_other', 'Other commune threshold', 'rain_gauge', 100, 'gte',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.alerts (
  id, commune_id, rule_id, device_id, severity, headline, description
) values
  (
    '40000000-0000-4000-8000-00000000e031',
    'ba_na', '40000000-0000-4000-8000-00000000e021',
    '40000000-0000-4000-8000-00000000e001',
    'watch', 'Ba Na alert', 'RLS test alert.'
  ),
  (
    '40000000-0000-4000-8000-00000000e032',
    'commune_other', '40000000-0000-4000-8000-00000000e022',
    '40000000-0000-4000-8000-00000000e002',
    'watch', 'Other commune alert', 'RLS test alert.'
  );

insert into public.alert_deliveries (
  id, alert_id, channel, recipient_scope, delivery_status
) values
  (
    '40000000-0000-4000-8000-00000000e041',
    '40000000-0000-4000-8000-00000000e031',
    'in_app', 'admin_xa', 'pending'
  ),
  (
    '40000000-0000-4000-8000-00000000e042',
    '40000000-0000-4000-8000-00000000e032',
    'in_app', 'admin_xa', 'pending'
  );

insert into public.tourism_places (
  id, commune_id, name, category, summary, status, created_by
) values
  (
    '40000000-0000-4000-8000-00000000e051',
    'ba_na', 'Ba Na tourism place', 'nature', 'RLS test place.',
    'draft', '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '40000000-0000-4000-8000-00000000e052',
    'commune_other', 'Other commune tourism place', 'nature', 'RLS test place.',
    'draft', '00000000-0000-4000-8000-00000000a006'
  );

insert into public.tourism_content (
  id, place_id, title, body, status, created_by
) values
  (
    '40000000-0000-4000-8000-00000000e061',
    '40000000-0000-4000-8000-00000000e051',
    'Ba Na tourism content', 'RLS test content.', 'draft',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '40000000-0000-4000-8000-00000000e062',
    '40000000-0000-4000-8000-00000000e052',
    'Other commune tourism content', 'RLS test content.', 'draft',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.report_import_batches (
  id, commune_id, period_id, mapping_version, expected_village_count, created_by
) values
  (
    '50000000-0000-4000-8000-00000000f001',
    'ba_na', '00000000-0000-4000-8000-00000000d001',
    'rls-v1', 1, '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '50000000-0000-4000-8000-00000000f002',
    'commune_other', '00000000-0000-4000-8000-00000000d002',
    'rls-v1', 1, '00000000-0000-4000-8000-00000000a006'
  );

insert into public.report_import_files (
  id, batch_id, source_filename, content_sha256, size_bytes,
  source_village_name, target_village_id, mapping_status,
  raw_values, normalized_values, validation_flags
) values
  (
    '50000000-0000-4000-8000-00000000f011',
    '50000000-0000-4000-8000-00000000f001',
    'ba-na.xlsx', repeat('5', 64), 1024, 'Ba Na test village',
    '00000000-0000-4000-8000-00000000c001', 'confirmed',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ),
  (
    '50000000-0000-4000-8000-00000000f012',
    '50000000-0000-4000-8000-00000000f002',
    'other.xlsx', repeat('6', 64), 1024, 'Other commune test village',
    '00000000-0000-4000-8000-00000000c003', 'confirmed',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  );

insert into public.report_import_resolutions (
  id, import_file_id, ct_code, raw_value, accepted_value,
  decision, reason, resolved_by
) values
  (
    '50000000-0000-4000-8000-00000000f021',
    '50000000-0000-4000-8000-00000000f011',
    'CT01', '10'::jsonb, 10, 'accepted', 'Ba Na RLS test',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '50000000-0000-4000-8000-00000000f022',
    '50000000-0000-4000-8000-00000000f012',
    'CT01', '30'::jsonb, 30, 'accepted', 'Other commune RLS test',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.report_import_lineage (
  report_id, import_file_id
) values
  (
    '00000000-0000-4000-8000-00000000b001',
    '50000000-0000-4000-8000-00000000f011'
  ),
  (
    '00000000-0000-4000-8000-00000000b003',
    '50000000-0000-4000-8000-00000000f012'
  );

insert into public.digital_maturity_assessments (
  id, commune_id, quarter_start, scores, evidence, created_by
) values
  (
    '60000000-0000-4000-8000-00000000a001',
    'ba_na', '2026-07-01', '{"overall":1}'::jsonb, '{}'::jsonb,
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '60000000-0000-4000-8000-00000000a002',
    'commune_other', '2026-07-01', '{"overall":2}'::jsonb, '{}'::jsonb,
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.innovation_initiatives (
  id, commune_id, title, problem_statement, value_hypothesis, created_by
) values
  (
    '60000000-0000-4000-8000-00000000a011',
    'ba_na', 'Ba Na initiative', 'RLS test problem.',
    'RLS test value hypothesis.',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '60000000-0000-4000-8000-00000000a012',
    'commune_other', 'Other commune initiative', 'RLS test problem.',
    'RLS test value hypothesis.',
    '00000000-0000-4000-8000-00000000a006'
  );

insert into public.ai_action_drafts (
  id, commune_id, period_id, village_id, kind, content, citations,
  confidence, model_provider, created_by
) values
  (
    '60000000-0000-4000-8000-00000000a021',
    'ba_na', '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000c001',
    'period_brief', 'Ba Na suggested content.', '[]'::jsonb,
    0.80, 'rls-test', '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '60000000-0000-4000-8000-00000000a022',
    'commune_other', '00000000-0000-4000-8000-00000000d002',
    '00000000-0000-4000-8000-00000000c003',
    'period_brief', 'Other commune suggested content.', '[]'::jsonb,
    0.80, 'rls-test', '00000000-0000-4000-8000-00000000a006'
  );

do $$
begin
  if has_table_privilege('anon', 'public.reports', 'select') then
    raise exception 'anon unexpectedly has direct report table access';
  end if;
  if has_table_privilege('anon', 'public.published_report_summary', 'select') then
    raise exception 'anon unexpectedly has direct public-view access';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', false);
do $$
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'can_bo_thon can read outside own village';
  end if;
  if (select count(*) from public.report_values where ct_code = 'CT14') <> 1 then
    raise exception 'can_bo_thon cannot read own-village CT14';
  end if;
  if (select count(*) from public.citizen_cases) <> 1
     or (select count(*) from public.case_locations) <> 1
     or (select count(*) from public.case_media) <> 1
     or (select count(*) from public.case_status_history) <> 1
     or (select count(*) from public.case_assignments) <> 1 then
    raise exception 'can_bo_thon citizen-case scope is incorrect';
  end if;
  if (select count(*) from public.knowledge_articles) <> 1
     or (select count(*) from public.knowledge_revisions) <> 1 then
    raise exception 'can_bo_thon approved knowledge scope is incorrect';
  end if;
  if (select count(*) from public.sensor_devices) <> 0
     or (select count(*) from public.report_import_batches) <> 0
     or (select count(*) from public.digital_maturity_assessments) <> 0 then
    raise exception 'can_bo_thon unexpectedly reads restricted pilot or governance data';
  end if;
  if (select count(*) from public.report_import_lineage) <> 1 then
    raise exception 'can_bo_thon report lineage should follow own-report scope';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a003', false);
do $$
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'to_cnscd assignment scope is incorrect';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a004', false);
do $$
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'lanh_dao should read commune reports';
  end if;
  if (select count(*) from public.citizen_cases) <> 1
     or (select count(*) from public.case_locations) <> 1
     or (select count(*) from public.case_media) <> 1
     or (select count(*) from public.case_status_history) <> 1
     or (select count(*) from public.case_assignments) <> 1 then
    raise exception 'lanh_dao citizen-case commune scope is incorrect';
  end if;
  if (select count(*) from public.knowledge_articles) <> 1
     or (select count(*) from public.knowledge_revisions) <> 1 then
    raise exception 'lanh_dao knowledge commune scope is incorrect';
  end if;
  if (select count(*) from public.sensor_devices) <> 1
     or (select count(*) from public.sensor_observations) <> 1
     or (select count(*) from public.sensor_health) <> 1
     or (select count(*) from public.alert_rules) <> 1
     or (select count(*) from public.alerts) <> 1
     or (select count(*) from public.alert_deliveries) <> 1
     or (select count(*) from public.tourism_places) <> 1
     or (select count(*) from public.tourism_content) <> 1 then
    raise exception 'lanh_dao pilot commune scope is incorrect';
  end if;
  if (select count(*) from public.report_import_batches) <> 1
     or (select count(*) from public.report_import_files) <> 0
     or (select count(*) from public.report_import_resolutions) <> 0
     or (select count(*) from public.report_import_lineage) <> 1 then
    raise exception 'lanh_dao import evidence privacy scope is incorrect';
  end if;
  if (select count(*) from public.action_items) <> 1
     or (select count(*) from public.digital_maturity_assessments) <> 1
     or (select count(*) from public.innovation_initiatives) <> 1
     or (select count(*) from public.ai_action_drafts) <> 1 then
    raise exception 'lanh_dao operations commune scope is incorrect';
  end if;
  begin
    update public.reports set report_source = 'direct_api'
    where id = '00000000-0000-4000-8000-00000000b001';
    raise exception 'lanh_dao unexpectedly retained direct report mutation';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a005', false);
do $$
begin
  if (select count(*) from public.reports) <> 1 then
    raise exception 'force-reset user should retain scoped read access';
  end if;
  begin
    update public.reports set report_source = 'direct_api'
    where id = '00000000-0000-4000-8000-00000000b002';
    raise exception 'force-reset user unexpectedly retained direct report mutation';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', false);
do $$
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'admin_xa should read all commune reports';
  end if;
  if (select count(*) from public.pending_updates) <> 1
     or exists (
       select 1 from public.pending_updates
       where submitter_phone = '0900000002'
     ) then
    raise exception 'admin_xa can read cross-commune citizen PII';
  end if;
  if (select count(*) from public.audit_log where action = 'RLS_TEST') <> 1
     or exists (
       select 1 from public.audit_log
       where commune_id <> 'ba_na'
     ) then
    raise exception 'admin_xa can read cross-commune audit records';
  end if;
  if (select count(*) from public.action_items) <> 1 then
    raise exception 'admin_xa can read cross-commune action items';
  end if;
  if (select count(*) from public.citizen_cases) <> 1
     or (select count(*) from public.case_locations) <> 1
     or (select count(*) from public.case_media) <> 1
     or (select count(*) from public.case_status_history) <> 1
     or (select count(*) from public.case_assignments) <> 1 then
    raise exception 'admin_xa citizen-case commune scope is incorrect';
  end if;
  if (select count(*) from public.digital_champions) <> 1
     or (select count(*) from public.community_support_points) <> 1
     or (select count(*) from public.knowledge_articles) <> 1
     or (select count(*) from public.knowledge_revisions) <> 1
     or (select count(*) from public.scenarios) <> 1
     or (select count(*) from public.scenario_assumptions) <> 1
     or (select count(*) from public.scenario_runs) <> 1 then
    raise exception 'admin_xa knowledge and scenario commune scope is incorrect';
  end if;
  if (select count(*) from public.sensor_devices) <> 1
     or (select count(*) from public.sensor_observations) <> 1
     or (select count(*) from public.sensor_health) <> 1
     or (select count(*) from public.alert_rules) <> 1
     or (select count(*) from public.alerts) <> 1
     or (select count(*) from public.alert_deliveries) <> 1
     or (select count(*) from public.tourism_places) <> 1
     or (select count(*) from public.tourism_content) <> 1 then
    raise exception 'admin_xa pilot commune scope is incorrect';
  end if;
  if (select count(*) from public.report_import_batches) <> 1
     or (select count(*) from public.report_import_files) <> 1
     or (select count(*) from public.report_import_resolutions) <> 1
     or (select count(*) from public.report_import_lineage) <> 1 then
    raise exception 'admin_xa import evidence commune scope is incorrect';
  end if;
  if (select count(*) from public.digital_maturity_assessments) <> 1
     or (select count(*) from public.innovation_initiatives) <> 1
     or (select count(*) from public.ai_action_drafts) <> 1 then
    raise exception 'admin_xa operations commune scope is incorrect';
  end if;
end
$$;
do $$
begin
  begin
    insert into public.case_assignments (
      id, case_id, department, assignee_id, assigned_by
    ) values (
      '20000000-0000-4000-8000-00000000c023',
      '20000000-0000-4000-8000-00000000c002',
      'Forbidden cross-commune case',
      '00000000-0000-4000-8000-00000000a002',
      '00000000-0000-4000-8000-00000000a001'
    );
    raise exception 'admin_xa unexpectedly assigned a cross-commune case';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.case_assignments (
      id, case_id, department, assignee_id, assigned_by
    ) values (
      '20000000-0000-4000-8000-00000000c024',
      '20000000-0000-4000-8000-00000000c001',
      'Forbidden cross-commune assignee',
      '00000000-0000-4000-8000-00000000a006',
      '00000000-0000-4000-8000-00000000a001'
    );
    raise exception 'admin_xa unexpectedly assigned an out-of-commune user';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform *
    from public.assign_citizen_case(
      '20000000-0000-4000-8000-00000000c001',
      'Forbidden cross-commune RPC assignee',
      '00000000-0000-4000-8000-00000000a006'
    );
    raise exception 'assignment RPC accepted an out-of-commune user';
  exception
    when check_violation then
      if sqlerrm <> 'assignee_not_in_commune' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.case_assignments
    where case_id = '20000000-0000-4000-8000-00000000c001'
      and assignee_id = '00000000-0000-4000-8000-00000000a006'
  ) then
    raise exception 'rejected cross-commune RPC assignment persisted';
  end if;
end
$$;
do $$
begin
  update public.reports set report_source = 'direct_api'
  where id = '00000000-0000-4000-8000-00000000b001';
  raise exception 'admin_xa unexpectedly retained direct report mutation';
exception
  when insufficient_privilege then null;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a006', false);
do $$
begin
  if (select count(*) from public.reports) <> 1
     or (select count(*) from public.pending_updates) <> 1
     or (select count(*) from public.audit_log where action = 'RLS_TEST') <> 1
     or (select count(*) from public.action_items) <> 1 then
    raise exception 'other-commune admin scope is incorrect';
  end if;
  if (select count(*) from public.citizen_cases) <> 1
     or (select count(*) from public.case_locations) <> 1
     or (select count(*) from public.case_media) <> 1
     or (select count(*) from public.case_status_history) <> 1
     or (select count(*) from public.case_assignments) <> 1 then
    raise exception 'other-commune admin citizen-case scope is incorrect';
  end if;
  if (select count(*) from public.digital_champions) <> 1
     or (select count(*) from public.community_support_points) <> 1
     or (select count(*) from public.knowledge_articles) <> 1
     or (select count(*) from public.knowledge_revisions) <> 1
     or (select count(*) from public.scenarios) <> 1
     or (select count(*) from public.scenario_assumptions) <> 1
     or (select count(*) from public.scenario_runs) <> 1 then
    raise exception 'other-commune admin knowledge scope is incorrect';
  end if;
  if (select count(*) from public.sensor_devices) <> 1
     or (select count(*) from public.sensor_observations) <> 1
     or (select count(*) from public.sensor_health) <> 1
     or (select count(*) from public.alert_rules) <> 1
     or (select count(*) from public.alerts) <> 1
     or (select count(*) from public.alert_deliveries) <> 1
     or (select count(*) from public.tourism_places) <> 1
     or (select count(*) from public.tourism_content) <> 1 then
    raise exception 'other-commune admin pilot scope is incorrect';
  end if;
  if (select count(*) from public.report_import_batches) <> 1
     or (select count(*) from public.report_import_files) <> 1
     or (select count(*) from public.report_import_resolutions) <> 1
     or (select count(*) from public.report_import_lineage) <> 1 then
    raise exception 'other-commune admin import evidence scope is incorrect';
  end if;
  if (select count(*) from public.digital_maturity_assessments) <> 1
     or (select count(*) from public.innovation_initiatives) <> 1
     or (select count(*) from public.ai_action_drafts) <> 1 then
    raise exception 'other-commune admin operations scope is incorrect';
  end if;
end
$$;
reset role;

-- Exercise the only supported report mutation path after direct table grants
-- have been revoked.
insert into public.report_periods (
  id, commune_id, name, due_date, created_by
) values (
  '00000000-0000-4000-8000-00000000d010',
  'ba_na',
  'Kỳ kiểm thử RPC báo cáo',
  '2026-08-17T17:00:00+07:00',
  '00000000-0000-4000-8000-00000000a001'
);
insert into public.report_period_villages (period_id, village_id)
values (
  '00000000-0000-4000-8000-00000000d010',
  '00000000-0000-4000-8000-00000000c001'
);
insert into public.report_periods (
  id, commune_id, name, due_date, created_by
) values (
  '00000000-0000-4000-8000-00000000d011',
  'ba_na',
  'Kỳ kiểm thử CT14',
  '2026-08-18T17:00:00+07:00',
  '00000000-0000-4000-8000-00000000a001'
);
insert into public.report_period_villages (period_id, village_id)
values (
  '00000000-0000-4000-8000-00000000d011',
  '00000000-0000-4000-8000-00000000c001'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', false);
do $$
begin
  perform *
  from public.save_manual_report_submission(
    '00000000-0000-4000-8000-00000000b010',
    '00000000-0000-4000-8000-00000000c001',
    '00000000-0000-4000-8000-00000000d010',
    'manual',
    jsonb_build_object(
      'CT01', 10, 'CT02', 40, 'CT03', 1, 'CT04', 1,
      'CT05', 1, 'CT06', 1, 'CT07', 10, 'CT08', 1,
      'CT09', 9, 'CT10', 20, 'CT11', 30, 'CT12', 6,
      'CT13', 2, 'CT14', 1
    ),
    '[]'::jsonb,
    0,
    '70000000-0000-4000-8000-00000000e010',
    true,
    false,
    null
  );

  if not exists (
    select 1
    from public.reports
    where id = '00000000-0000-4000-8000-00000000b010'
      and workflow_status = 'submitted'
      and publication_status = 'private'
      and version = 1
  ) then
    raise exception 'scoped report RPC did not persist the submitted report';
  end if;

  begin
    perform *
    from public.save_manual_report_submission(
      '00000000-0000-4000-8000-00000000b011',
      '00000000-0000-4000-8000-00000000c001',
      '00000000-0000-4000-8000-00000000d011',
      'manual',
      jsonb_build_object(
        'CT01', 10, 'CT02', 40, 'CT03', 1, 'CT04', 1,
        'CT05', 1, 'CT06', 1, 'CT07', 10, 'CT08', 1,
        'CT09', 9, 'CT10', 20, 'CT11', 30, 'CT12', 6,
        'CT13', 2, 'CT14', 11
      ),
      '[]'::jsonb,
      0,
      '70000000-0000-4000-8000-00000000e011',
      true,
      false,
      null
    );
    raise exception 'database accepted CT14 greater than CT01';
  exception
    when check_violation then null;
  end;

  if exists (
    select 1
    from public.reports
    where id = '00000000-0000-4000-8000-00000000b011'
  ) then
    raise exception 'rejected CT14 submission left persisted data';
  end if;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', false);
do $$
begin
  begin
    perform *
    from public.save_manual_report_submission(
      '00000000-0000-4000-8000-00000000b012',
      '00000000-0000-4000-8000-00000000c001',
      '00000000-0000-4000-8000-00000000d010',
      'manual',
      jsonb_build_object(
        'CT01', 10, 'CT02', 40, 'CT03', 1, 'CT04', 1,
        'CT05', 1, 'CT06', 1, 'CT07', 10, 'CT08', 1,
        'CT09', 9, 'CT10', 20, 'CT11', 30, 'CT12', 6,
        'CT13', 2, 'CT14', 1
      ),
      '[]'::jsonb,
      0,
      '70000000-0000-4000-8000-00000000e012',
      true,
      false,
      null
    );
    raise exception 'admin_xa unexpectedly entered standard village data';
  exception
    when insufficient_privilege then null;
  end;

  perform *
  from public.transition_report_workflow(
    '00000000-0000-4000-8000-00000000b010',
    1,
    'approve'
  );

  begin
    perform *
    from public.transition_report_workflow(
      '00000000-0000-4000-8000-00000000b010',
      1,
      'lock'
    );
    raise exception 'stale workflow version unexpectedly succeeded';
  exception
    when serialization_failure then null;
  end;

  perform *
  from public.transition_report_workflow(
    '00000000-0000-4000-8000-00000000b010',
    2,
    'lock'
  );
  perform *
  from public.transition_report_workflow(
    '00000000-0000-4000-8000-00000000b010',
    3,
    'publish'
  );

  if not exists (
    select 1
    from public.reports
    where id = '00000000-0000-4000-8000-00000000b010'
      and workflow_status = 'locked'
      and publication_status = 'published'
      and version = 4
  ) then
    raise exception 'admin workflow transitions did not reach the published state';
  end if;
  if (
    select count(*)
    from public.audit_log
    where record_id = '00000000-0000-4000-8000-00000000b010'
      and action in ('REPORT_APPROVE', 'REPORT_LOCK', 'REPORT_PUBLISH')
  ) <> 3 then
    raise exception 'report workflow transition audit trail is incomplete';
  end if;

  begin
    perform *
    from public.delete_report_submission(
      '00000000-0000-4000-8000-00000000b010',
      4
    );
    raise exception 'published report was hard deleted';
  exception
    when insufficient_privilege then null;
  end;

end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a002', false);
do $$
begin
  begin
    perform *
    from public.save_manual_report_submission(
      '00000000-0000-4000-8000-00000000b013',
      '00000000-0000-4000-8000-00000000c001',
      '00000000-0000-4000-8000-00000000d002',
      'manual',
      jsonb_build_object(
        'CT01', 10, 'CT02', 40, 'CT03', 1, 'CT04', 1,
        'CT05', 1, 'CT06', 1, 'CT07', 10, 'CT08', 1,
        'CT09', 9, 'CT10', 20, 'CT11', 30, 'CT12', 6,
        'CT13', 2, 'CT14', 1
      ),
      '[]'::jsonb,
      0,
      '70000000-0000-4000-8000-00000000e013',
      true,
      false,
      null
    );
    raise exception 'unassigned report period accepted a submission';
  exception
    when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Report-period correction and soft deletion require an immutable two-role
-- workflow. Direct table mutations remain unavailable to authenticated users.
insert into public.report_periods (
  id, commune_id, name, due_date, created_by
) values
  (
    '00000000-0000-4000-8000-00000000d012', 'ba_na',
    'Kỳ cần điều chỉnh', '2099-08-17T17:00:00+07:00',
    '00000000-0000-4000-8000-00000000a001'
  ),
  (
    '00000000-0000-4000-8000-00000000d013', 'ba_na',
    'Kỳ cần lưu trữ', '2099-08-18T17:00:00+07:00',
    '00000000-0000-4000-8000-00000000a001'
  );
insert into public.report_period_villages (period_id, village_id) values
  ('00000000-0000-4000-8000-00000000d012', '00000000-0000-4000-8000-00000000c001'),
  ('00000000-0000-4000-8000-00000000d013', '00000000-0000-4000-8000-00000000c001');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', false);
select public.create_report_period_change_request(
  '00000000-0000-4000-8000-00000000d012',
  'update',
  'Điều chỉnh theo biên bản kiểm tra nghiệp vụ.',
  'Kỳ đã điều chỉnh',
  '2099-08-20T17:00:00+07:00',
  array[
    '00000000-0000-4000-8000-00000000c001'::uuid,
    '00000000-0000-4000-8000-00000000c002'::uuid
  ]
);
select public.create_report_period_change_request(
  '00000000-0000-4000-8000-00000000d013',
  'delete',
  'Kỳ được tạo trùng và cần lưu trữ theo biên bản.',
  null, null, null
);
do $$
begin
  begin
    update public.report_periods
    set name = 'Lách quy trình'
    where id = '00000000-0000-4000-8000-00000000d012';
    raise exception 'administrator directly changed a report period';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a004', false);
select public.decide_report_period_change_request(
  (
    select id from public.report_period_change_requests
    where period_id = '00000000-0000-4000-8000-00000000d012'
  ),
  'approved',
  'Đủ căn cứ và đúng phạm vi phê duyệt.'
);
select public.decide_report_period_change_request(
  (
    select id from public.report_period_change_requests
    where period_id = '00000000-0000-4000-8000-00000000d013'
  ),
  'approved',
  'Đồng ý lưu trữ kỳ bị trùng.'
);
do $$
begin
  if not exists (
    select 1 from public.report_periods
    where id = '00000000-0000-4000-8000-00000000d012'
      and name = 'Kỳ đã điều chỉnh'
      and due_date = '2099-08-20T17:00:00+07:00'::timestamptz
  ) then
    raise exception 'approved report-period update was not applied';
  end if;
  if (
    select count(*) from public.report_period_villages
    where period_id = '00000000-0000-4000-8000-00000000d012'
  ) <> 2 then
    raise exception 'approved village-scope update was not applied';
  end if;
  if not exists (
    select 1 from public.report_periods
    where id = '00000000-0000-4000-8000-00000000d013'
      and archived_at is not null
      and archived_by_request_id is not null
  ) then
    raise exception 'approved deletion did not soft archive the period';
  end if;
  if (
    select count(*) from public.report_period_change_decisions
    where decision = 'approved'
      and request_id in (
        select id from public.report_period_change_requests
        where period_id in (
          '00000000-0000-4000-8000-00000000d012',
          '00000000-0000-4000-8000-00000000d013'
        )
      )
  ) <> 2 then
    raise exception 'leadership decision history is incomplete';
  end if;
end
$$;
reset role;

do $$
begin
  begin
    update public.report_period_change_requests
    set reason = 'Không được phép sửa lịch sử đã lưu.'
    where period_id = '00000000-0000-4000-8000-00000000d012';
    raise exception 'request history was mutable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.report_period_change_decisions
    where request_id in (
      select id from public.report_period_change_requests
      where period_id = '00000000-0000-4000-8000-00000000d013'
    );
    raise exception 'decision history was deletable';
  exception when insufficient_privilege then null;
  end;
end
$$;

rollback;
