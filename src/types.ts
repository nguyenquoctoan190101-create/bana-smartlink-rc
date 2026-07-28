export const INDICATOR_CODES = [
  "CT01", "CT02", "CT03", "CT04", "CT05", "CT06", "CT07",
  "CT08", "CT09", "CT10", "CT11", "CT12", "CT13", "CT14",
] as const;

export const PUBLIC_INDICATOR_CODES = ["CT01", "CT02", "CT09", "CT12", "CT13"] as const;

export type IndicatorCode = (typeof INDICATOR_CODES)[number];
export type PublicIndicatorCode = (typeof PUBLIC_INDICATOR_CODES)[number];
export type IndicatorValues = Record<IndicatorCode, number | null>;

export interface IndicatorSchema {
  name: string;
  unit: string;
  type: "integer";
  min: number;
  warning_multiplier_min?: number;
  warning_multiplier_max?: number;
  warning_ratio_min?: number;
  warning_ratio_max?: number;
  warning_ratio_ref?: string;
  warning_message?: string;
  max_ref?: string;
  error_message?: string;
  sum_max_ref?: string[];
  max_limit_ref?: string;
}

export interface ValidationRules {
  [key: string]: IndicatorSchema;
}

export type WorkflowStatus = "draft" | "submitted" | "needs_revision" | "approved" | "locked";
export type TimelinessStatus = "not_submitted" | "on_time" | "late";
export type PublicationStatus = "private" | "published";
export type ReportSource = "manual" | "excel" | "photo_ocr" | "direct_api";

export interface ExtractionCorrection {
  code: IndicatorCode;
  before: number | null;
  after: number;
  reason: string;
}

export interface ExtractionMetadata {
  source_checksum: string;
  source_type: "excel" | "photo_ocr" | "pdf_ocr";
  extractor_versions: string[];
  field_count: number;
  requires_review_count: number;
  template_version?: string | null;
  rule_version?: string | null;
  evidence_sha256?: string | null;
  evidence?: Partial<Record<IndicatorCode, {
    confidence: number;
    source_page?: number | null;
    source_region?: string | null;
    extractor: string;
    method: string;
    version: string;
    flags: string[];
    requires_review: boolean;
  }>>;
  quality_summary?: {
    status: "ready" | "needs_review" | "blocked";
    mean_confidence: number;
    blocking_flag_count: number;
    warning_flag_count: number;
  } | null;
}

/**
 * Frontend report view model. The legacy `status` field is accepted only while
 * reading older offline drafts; new code must use the three explicit statuses.
 */
export interface ReportData extends IndicatorValues {
  id: string;
  village_id: string;
  period_id?: string;
  reporter_name: string;
  reporter_phone: string;
  report_period: string;
  workflow_status: WorkflowStatus;
  timeliness_status: TimelinessStatus;
  publication_status: PublicationStatus;
  status?: "Draft" | "Submitted" | "Approved" | "dung_han" | "tre_han" | "Locked" | "locked";
  version?: number;
  expected_version?: number;
  idempotency_key?: string;
  updated_at: string;
  submitted_at?: string | null;
  submission_next_step?: "await_commune_review";
  submission_replayed?: boolean;
  approved_at?: string | null;
  published_at?: string | null;
  assisted_by_cnscd?: boolean;
  assisted_member_name?: string;
  raw_source?: ReportSource;
  source_confirmed?: boolean;
  extraction_corrections?: ExtractionCorrection[];
  extraction_metadata?: ExtractionMetadata;
  extraction_review_token?: string;
  pending_sync?: boolean;
  /** Frontend-only marker: this report exists only in the current browser. */
  local_only?: boolean;
}

export interface Village {
  id: string;
  name: string;
}

export interface ReportPeriod {
  id: string;
  name: string;
  due_date: string;
  /** Villages explicitly assigned when the period was created. */
  village_ids?: string[];
  /** Frontend-only safe label for legacy periods whose name needs review. */
  display_name?: string;
  /** Frontend-only marker; never changes the stored period name or identifier. */
  requires_review?: boolean;
}

export interface OldVillage {
  id: string;
  name: string;
  target_new_id: string | null;
  proposed_target_new_id?: string;
  mapping_status?: "confirmed" | "pending_official_decision";
}

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export type UserRole = "admin_xa" | "can_bo_thon" | "to_cnscd" | "lanh_dao" | "dan";

export interface UserSession {
  role: UserRole;
  village_id: string | null;
  email: string;
}

export interface AuthProfile {
  id: string;
  role: Exclude<UserRole, "dan">;
  village_id: string | null;
  display_name: string;
  phone: string | null;
  is_active: boolean;
  force_password_reset: boolean;
  assigned_village_ids?: string[];
  mfa_required?: boolean;
  mfa_verified?: boolean;
}

export interface NarrativeAnalysisResponse {
  warnings: string[];
  recommendations: string[];
  data_period?: string;
  source?: string;
}

// Kept as an alias while the existing presentation component is migrated.
export interface GeminiAnalysisResponse extends NarrativeAnalysisResponse {
  is_valid: boolean;
  errors: string[];
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  detail?: string | { code?: string; message?: string };
  details?: unknown;
  request_id?: string;
}

export interface SyncAcceptedItem {
  client_id: string;
  report_id: string;
  version: number;
  workflow_status: WorkflowStatus;
  timeliness_status: TimelinessStatus;
  publication_status: PublicationStatus;
  server_received_at: string;
  next_step: "await_commune_review";
  replayed: boolean;
}

export interface SyncRejectedItem {
  client_id: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface SyncReportsResponse {
  accepted: SyncAcceptedItem[];
  rejected: SyncRejectedItem[];
}

export function workflowStatusOf(report: Pick<ReportData, "workflow_status" | "status">): WorkflowStatus {
  if (report.workflow_status) return report.workflow_status;
  switch (report.status) {
    case "Submitted": return "submitted";
    case "Approved": return "approved";
    case "Locked":
    case "locked": return "locked";
    default: return "draft";
  }
}

export function isPubliclyVisibleReport(
  report: Pick<ReportData, "workflow_status" | "publication_status">,
): boolean {
  return (
    report.publication_status === "published"
    && (report.workflow_status === "approved" || report.workflow_status === "locked")
  );
}
