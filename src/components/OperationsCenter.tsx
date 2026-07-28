import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BrainCircuit, CalendarDays, CheckCircle2, ClipboardList, Clock3, DatabaseZap, FileCheck2, GitCompareArrows, Link2, Loader2, ShieldCheck, Sparkles, Target, UserRoundCheck } from "lucide-react";
import { apiFetch, apiJson, toUserFacingError } from "../lib/apiClient";
import { auditActionLabel, auditObjectLabel } from "../lib/auditPresentation";
import type { ReportPeriod, UserRole } from "../types";
import { ActionCard, Button, DataScope, EmptyState, ErrorState, MetricCard, PageHeader, StatusBadge, WorkSection } from "./ui";
import "./OperationsCenter.css";

type Props = {
  periodId: string;
  role: UserRole;
  periods?: ReportPeriod[];
  maturityEnabled?: boolean;
  onNavigate?: (target: "dashboard" | "cases" | "progress-dashboard") => void;
};
type Action = {
  id: string;
  period_id?: string | null;
  village_id?: string | null;
  source_type: "manual" | "trend_alert" | "ai_draft" | "maturity" | "initiative" | "proposal";
  title: string;
  description?: string | null;
  priority: "low" | "normal" | "high" | "critical";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  owner_id?: string | null;
  owner_name?: string | null;
  owner_label: string;
  due_date?: string | null;
  due_state: "overdue" | "due_today" | "upcoming" | "unset" | "closed";
  created_at: string;
  age_days: number;
  evidence_status: "linked" | "manual" | "missing";
  can_update: boolean;
  next_action?: "start" | "complete" | null;
};
type AiDecisionOption = {
  id: "A" | "B" | "C";
  title: string;
  rationale: string;
  tradeoff: string;
  urgency: "ngay" | "trong_ky" | "theo_doi";
  evidence_ids: string[];
};
type AiDecisionRisk = {
  title: string;
  severity: "cao" | "trung_binh" | "thap";
  mitigation: string;
  evidence_ids: string[];
};
type AiDecisionAnalysis = {
  executive_assessment: string;
  recommended_option_id: "A" | "B" | "C";
  options: AiDecisionOption[];
  risks: AiDecisionRisk[];
  reviewer_questions: string[];
  assumptions: string[];
};
type DraftCitation = {
  kind?: string;
  id?: string;
  label?: string;
  status?: string;
  provider?: string;
  model?: string;
  prompt_version?: string;
  analysis?: unknown;
  village_name?: string;
  quality_status?: string;
  completeness_percent?: number;
  completeness_numerator?: number;
  completeness_denominator?: number;
  validity_percent?: number;
  blocking_flag_count?: number;
  timeliness_percent?: number;
  unresolved_flag_count?: number;
  outlier_count?: number;
  timeliness_status?: string;
  report_source?: string;
  report_version?: number;
  rule_version?: string;
  generator_version?: string;
  report_count?: number;
  ready_report_count?: number;
  complete_field_count?: number;
  expected_field_count?: number;
  valid_report_count?: number;
  timely_report_count?: number;
  blocked_report_count?: number;
  review_report_count?: number;
  late_report_count?: number;
  open_action_count?: number;
  overdue_action_count?: number;
};
type DecisionDraft = {
  id: string;
  period_id?: string | null;
  status: "pending_review" | "accepted" | "rejected";
  content: string;
  citations?: unknown;
  confidence?: number | null;
  model_provider?: string;
  review_notes?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};
type DecisionBriefSections = {
  conclusion: string;
  priority: string;
  action: string;
  basis: string;
  limitation: string;
};
type Quality = {
  report_id: string;
  village_name: string;
  workflow_status?: string;
  completeness_percent?: number;
  completeness_numerator?: number;
  completeness_denominator?: number;
  validity_percent?: number;
  blocking_flag_count?: number;
  timeliness_percent?: number;
  timeliness_status?: string;
  quality_status: string;
  unresolved_flag_count: number;
  outlier_count: number;
  lineage: { report_source: string; report_version: number };
};
type QualityResponse = {
  period?: { id: string; name?: string | null };
  generated_at?: string;
  reports?: Quality[];
  rule_version?: string;
};
type AuditEntry = {
  id: string;
  action: string;
  table_name: string;
  record_id: string;
  user_id: string | null;
  created_at: string;
};
type LoadResult = {
  key:
    | "quality"
    | "actions"
    | "drafts"
    | "maturity"
    | "initiatives"
    | "audit";
  label: string;
  value: unknown;
  error?: unknown;
};
type Availability = Record<LoadResult["key"], boolean | null>;
const EMPTY_PERIODS: ReportPeriod[] = [];
const aiUrgencyLabels: Record<AiDecisionOption["urgency"], string> = {
  ngay: "Nên xem ngay",
  trong_ky: "Xử lý trong kỳ",
  theo_doi: "Theo dõi",
};
const aiSeverityLabels: Record<AiDecisionRisk["severity"], string> = {
  cao: "Rủi ro cao",
  trung_binh: "Rủi ro trung bình",
  thap: "Rủi ro thấp",
};

const decisionStatuses = new Set<DecisionDraft["status"]>([
  "pending_review",
  "accepted",
  "rejected",
]);
const aiOptionIds = new Set<AiDecisionOption["id"]>(["A", "B", "C"]);
const aiUrgencies = new Set<AiDecisionOption["urgency"]>([
  "ngay",
  "trong_ky",
  "theo_doi",
]);
const aiSeverities = new Set<AiDecisionRisk["severity"]>([
  "cao",
  "trung_binh",
  "thap",
]);
const actionSourceTypes = new Set<Action["source_type"]>([
  "manual",
  "trend_alert",
  "ai_draft",
  "maturity",
  "initiative",
  "proposal",
]);
const actionPriorities = new Set<Action["priority"]>([
  "low",
  "normal",
  "high",
  "critical",
]);
const actionStatuses = new Set<Action["status"]>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
const actionDueStates = new Set<Action["due_state"]>([
  "overdue",
  "due_today",
  "upcoming",
  "unset",
  "closed",
]);
const actionEvidenceStatuses = new Set<Action["evidence_status"]>([
  "linked",
  "manual",
  "missing",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value == null || typeof value === "string";
}

function isAuditEntry(value: unknown): value is AuditEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.table_name === "string" &&
    typeof value.record_id === "string" &&
    (value.user_id === null || typeof value.user_id === "string") &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at))
  );
}

function shortAuditReference(value: string | null): string {
  if (!value) return "Hệ thống";
  const compact = value.replace(/-/g, "");
  return compact ? compact.slice(0, 8).toUpperCase() : "Hệ thống";
}

function isActionQueueItem(value: unknown): value is Action {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.source_type === "string" &&
    actionSourceTypes.has(value.source_type as Action["source_type"]) &&
    typeof value.priority === "string" &&
    actionPriorities.has(value.priority as Action["priority"]) &&
    typeof value.status === "string" &&
    actionStatuses.has(value.status as Action["status"]) &&
    isOptionalString(value.period_id) &&
    isOptionalString(value.village_id) &&
    isOptionalString(value.description) &&
    isOptionalString(value.owner_id) &&
    isOptionalString(value.owner_name) &&
    typeof value.owner_label === "string" &&
    isOptionalString(value.due_date) &&
    typeof value.due_state === "string" &&
    actionDueStates.has(value.due_state as Action["due_state"]) &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at)) &&
    typeof value.age_days === "number" &&
    Number.isInteger(value.age_days) &&
    value.age_days >= 0 &&
    typeof value.evidence_status === "string" &&
    actionEvidenceStatuses.has(
      value.evidence_status as Action["evidence_status"],
    ) &&
    typeof value.can_update === "boolean" &&
    (value.next_action == null ||
      value.next_action === "start" ||
      value.next_action === "complete")
  );
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

type DimensionEvidence = {
  numerator: number;
  denominator: number;
  percent: number | null;
  reportsWithEvidence: number;
  reportsNeedingReview: number;
};

type QualityDimensions = {
  completeness: DimensionEvidence;
  validity: DimensionEvidence;
  timeliness: DimensionEvidence;
};

function dimensionPercent(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? Math.round((numerator * 1000) / denominator) / 10
    : null;
}

function summarizeQualityDimensions(reports: Quality[]): QualityDimensions {
  const completenessEvidence = reports.filter(
    (item) =>
      typeof item.completeness_numerator === "number" &&
      Number.isFinite(item.completeness_numerator) &&
      typeof item.completeness_denominator === "number" &&
      Number.isFinite(item.completeness_denominator) &&
      item.completeness_denominator > 0,
  );
  const completeFieldCount = completenessEvidence.reduce(
    (total, item) => total + (item.completeness_numerator || 0),
    0,
  );
  const expectedFieldCount = completenessEvidence.reduce(
    (total, item) => total + (item.completeness_denominator || 0),
    0,
  );
  const validityEvidence = reports.filter(
    (item) =>
      typeof item.validity_percent === "number" &&
      Number.isFinite(item.validity_percent),
  );
  const validReportCount = validityEvidence.filter(
    (item) => item.validity_percent === 100,
  ).length;
  const timelinessEvidence = reports.filter((item) =>
    ["on_time", "late", "not_submitted"].includes(
      item.timeliness_status || "",
    ),
  );
  const timelyReportCount = timelinessEvidence.filter(
    (item) => item.timeliness_status === "on_time",
  ).length;

  return {
    completeness: {
      numerator: completeFieldCount,
      denominator: expectedFieldCount,
      percent: dimensionPercent(completeFieldCount, expectedFieldCount),
      reportsWithEvidence: completenessEvidence.length,
      reportsNeedingReview: completenessEvidence.filter(
        (item) =>
          (item.completeness_numerator || 0) <
          (item.completeness_denominator || 0),
      ).length,
    },
    validity: {
      numerator: validReportCount,
      denominator: validityEvidence.length,
      percent: dimensionPercent(validReportCount, validityEvidence.length),
      reportsWithEvidence: validityEvidence.length,
      reportsNeedingReview: validityEvidence.length - validReportCount,
    },
    timeliness: {
      numerator: timelyReportCount,
      denominator: timelinessEvidence.length,
      percent: dimensionPercent(timelyReportCount, timelinessEvidence.length),
      reportsWithEvidence: timelinessEvidence.length,
      reportsNeedingReview: timelinessEvidence.length - timelyReportCount,
    },
  };
}

function formatDimensionPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}%`
    : "—";
}

function isDecisionDraft(value: unknown): value is DecisionDraft {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.content === "string" &&
    typeof value.status === "string" &&
    decisionStatuses.has(value.status as DecisionDraft["status"]) &&
    isOptionalString(value.period_id) &&
    isOptionalString(value.model_provider) &&
    isOptionalString(value.review_notes) &&
    isOptionalString(value.reviewed_at) &&
    isOptionalString(value.created_at) &&
    (value.confidence == null ||
      (typeof value.confidence === "number" &&
        Number.isFinite(value.confidence)))
  );
}

function hasValidReviewMetadata(draft: DecisionDraft): boolean {
  const notes = draft.review_notes?.trim() || "";
  return (
    notes.length >= 10 &&
    notes.length <= 2000 &&
    typeof draft.reviewed_at === "string" &&
    draft.reviewed_at.trim().length > 0 &&
    Number.isFinite(Date.parse(draft.reviewed_at))
  );
}

function isOfficialAcceptedDraft(draft: DecisionDraft): boolean {
  return draft.status === "accepted" && hasValidReviewMetadata(draft);
}

function isTerminalDraftMissingReviewMetadata(
  draft: DecisionDraft,
): boolean {
  return (
    (draft.status === "accepted" || draft.status === "rejected") &&
    !hasValidReviewMetadata(draft)
  );
}

function asDraftCitations(value: unknown): DraftCitation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((citation) => ({
    kind: asOptionalString(citation.kind),
    id: asOptionalString(citation.id),
    label: asOptionalString(citation.label),
    status: asOptionalString(citation.status),
    provider: asOptionalString(citation.provider),
    model: asOptionalString(citation.model),
    prompt_version: asOptionalString(citation.prompt_version),
    analysis: citation.analysis,
    village_name: asOptionalString(citation.village_name),
    quality_status: asOptionalString(citation.quality_status),
    completeness_percent: asOptionalFiniteNumber(
      citation.completeness_percent,
    ),
    completeness_numerator: asOptionalFiniteNumber(
      citation.completeness_numerator,
    ),
    completeness_denominator: asOptionalFiniteNumber(
      citation.completeness_denominator,
    ),
    validity_percent: asOptionalFiniteNumber(citation.validity_percent),
    blocking_flag_count: asOptionalFiniteNumber(
      citation.blocking_flag_count,
    ),
    timeliness_percent: asOptionalFiniteNumber(citation.timeliness_percent),
    unresolved_flag_count: asOptionalFiniteNumber(
      citation.unresolved_flag_count,
    ),
    outlier_count: asOptionalFiniteNumber(citation.outlier_count),
    timeliness_status: asOptionalString(citation.timeliness_status),
    report_source: asOptionalString(citation.report_source),
    report_version: asOptionalFiniteNumber(citation.report_version),
    rule_version: asOptionalString(citation.rule_version),
    generator_version: asOptionalString(citation.generator_version),
    report_count: asOptionalFiniteNumber(citation.report_count),
    ready_report_count: asOptionalFiniteNumber(citation.ready_report_count),
    complete_field_count: asOptionalFiniteNumber(
      citation.complete_field_count,
    ),
    expected_field_count: asOptionalFiniteNumber(
      citation.expected_field_count,
    ),
    valid_report_count: asOptionalFiniteNumber(
      citation.valid_report_count,
    ),
    timely_report_count: asOptionalFiniteNumber(
      citation.timely_report_count,
    ),
    blocked_report_count: asOptionalFiniteNumber(
      citation.blocked_report_count,
    ),
    review_report_count: asOptionalFiniteNumber(
      citation.review_report_count,
    ),
    late_report_count: asOptionalFiniteNumber(citation.late_report_count),
    open_action_count: asOptionalFiniteNumber(citation.open_action_count),
    overdue_action_count: asOptionalFiniteNumber(
      citation.overdue_action_count,
    ),
  }));
}

function isAiDecisionOption(value: unknown): value is AiDecisionOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    aiOptionIds.has(value.id as AiDecisionOption["id"]) &&
    typeof value.title === "string" &&
    typeof value.rationale === "string" &&
    typeof value.tradeoff === "string" &&
    typeof value.urgency === "string" &&
    aiUrgencies.has(value.urgency as AiDecisionOption["urgency"]) &&
    isStringArray(value.evidence_ids)
  );
}

function isAiDecisionRisk(value: unknown): value is AiDecisionRisk {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.severity === "string" &&
    aiSeverities.has(value.severity as AiDecisionRisk["severity"]) &&
    typeof value.mitigation === "string" &&
    isStringArray(value.evidence_ids)
  );
}

function isAiDecisionAnalysis(value: unknown): value is AiDecisionAnalysis {
  if (
    !isRecord(value) ||
    typeof value.executive_assessment !== "string" ||
    typeof value.recommended_option_id !== "string" ||
    !aiOptionIds.has(value.recommended_option_id as AiDecisionOption["id"]) ||
    !Array.isArray(value.options) ||
    !value.options.every(isAiDecisionOption) ||
    !Array.isArray(value.risks) ||
    !value.risks.every(isAiDecisionRisk) ||
    !isStringArray(value.reviewer_questions) ||
    !isStringArray(value.assumptions)
  ) {
    return false;
  }
  const optionIds = value.options.map((option) => option.id);
  return (
    optionIds.length > 0 &&
    new Set(optionIds).size === optionIds.length &&
    optionIds.includes(value.recommended_option_id as AiDecisionOption["id"])
  );
}

const DECISION_SECTION_PREFIXES: Array<
  [keyof DecisionBriefSections, string]
> = [
  ["conclusion", "Kết luận:"],
  ["priority", "Mức ưu tiên:"],
  ["action", "Hành động đề xuất:"],
  ["basis", "Căn cứ:"],
  ["limitation", "Giới hạn:"],
];

function parseDecisionBrief(content: string): DecisionBriefSections {
  const result: DecisionBriefSections = {
    conclusion: "Chưa có kết luận xác định trong bản tóm tắt này.",
    priority: "Chưa phân loại",
    action: "Người có thẩm quyền đọc căn cứ và xác định bước xử lý tiếp theo.",
    basis: "Xem danh sách căn cứ đi kèm bản tóm tắt.",
    limitation:
      "Đây là nội dung hỗ trợ; không thay thế quyết định của người có thẩm quyền.",
  };
  let foundStructuredSection = false;
  let activeKey: keyof DecisionBriefSections | null = null;
  const parsedSections: Partial<
    Record<keyof DecisionBriefSections, string[]>
  > = {};
  for (const line of content.split(/\r?\n/)) {
    const normalizedLine = line.trim();
    const matched = DECISION_SECTION_PREFIXES.find(([, prefix]) =>
      normalizedLine.startsWith(prefix),
    );
    if (matched) {
      foundStructuredSection = true;
      const [key, prefix] = matched;
      activeKey = key;
      const firstValue = normalizedLine.slice(prefix.length).trim();
      parsedSections[key] = firstValue ? [firstValue] : [];
      continue;
    }
    if (activeKey && normalizedLine) {
      parsedSections[activeKey] = [
        ...(parsedSections[activeKey] || []),
        normalizedLine,
      ];
    }
  }
  if (!foundStructuredSection) {
    result.conclusion = content.trim() || result.conclusion;
    return result;
  }
  for (const [key, lines] of Object.entries(parsedSections) as Array<
    [keyof DecisionBriefSections, string[]]
  >) {
    const value = lines.join(" ").trim();
    if (value) result[key] = value;
  }
  return result;
}

const reportSourceLabels: Record<string, string> = {
  manual: "Nhập thủ công",
  excel: "Tệp Excel",
  photo_ocr: "Ảnh OCR",
  direct_api: "API trực tiếp",
};

const timelinessLabels: Record<string, string> = {
  on_time: "Đúng hạn",
  late: "Nộp muộn",
  not_submitted: "Chưa nộp",
};

const priorityLabels: Record<string, string> = {
  low: "thấp",
  normal: "thông thường",
  high: "cao",
  critical: "khẩn cấp",
};

const actionSourceLabels: Record<Action["source_type"], string> = {
  manual: "Giao việc thủ công",
  trend_alert: "Cảnh báo xu hướng",
  ai_draft: "Bản nháp hỗ trợ",
  maturity: "Đánh giá trưởng thành",
  initiative: "Sáng kiến",
  proposal: "Đề xuất",
};

const actionDueLabels: Record<Action["due_state"], string> = {
  overdue: "quá hạn",
  due_today: "đến hạn hôm nay",
  upcoming: "sắp đến hạn",
  unset: "chưa đặt hạn",
  closed: "đã đóng",
};

const actionEvidenceLabels: Record<Action["evidence_status"], string> = {
  linked: "có căn cứ liên kết",
  manual: "giao việc thủ công",
  missing: "thiếu căn cứ liên kết",
};

const actionDueOrder: Record<Action["due_state"], number> = {
  overdue: 0,
  due_today: 1,
  upcoming: 2,
  unset: 3,
  closed: 4,
};

const actionPriorityOrder: Record<Action["priority"], number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function compareActionQueueItems(left: Action, right: Action): number {
  const dueDateDifference =
    (left.due_date ? Date.parse(left.due_date) : Number.POSITIVE_INFINITY) -
    (right.due_date ? Date.parse(right.due_date) : Number.POSITIVE_INFINITY);
  const createdDifference =
    Date.parse(left.created_at) - Date.parse(right.created_at);
  return (
    actionDueOrder[left.due_state] - actionDueOrder[right.due_state] ||
    actionPriorityOrder[left.priority] - actionPriorityOrder[right.priority] ||
    dueDateDifference ||
    createdDifference ||
    left.id.localeCompare(right.id)
  );
}

const roleCopy: Record<string, { eyebrow: string; title: string; description: string }> = {
  admin_xa: {
    eyebrow: "Điều hành toàn xã",
    title: "Công việc điều hành",
    description: "Ưu tiên việc quá hạn và cảnh báo dữ liệu trước khi xem số liệu tổng hợp.",
  },
  lanh_dao: {
    eyebrow: "Điều hành toàn xã",
    title: "Tóm tắt điều hành",
    description: "Tổng hợp việc cần xử lý, chất lượng dữ liệu và căn cứ theo kỳ báo cáo.",
  },
  can_bo_thon: {
    eyebrow: "Không gian cán bộ thôn",
    title: "Việc của tôi",
    description: "Hoàn thành việc được giao, rà soát báo cáo và theo dõi trạng thái nộp.",
  },
  to_cnscd: {
    eyebrow: "Tổ công nghệ số cộng đồng",
    title: "Việc hỗ trợ của tôi",
    description: "Theo dõi việc hỗ trợ thôn và các báo cáo cần đối chiếu dữ liệu.",
  },
};

const roleOverviewCopy: Record<string, { title: string; description: string }> = {
  admin_xa: {
    title: "Ưu tiên điều hành",
    description: "Xem phạm vi dữ liệu, kết luận cần chú ý và các chỉ số phải xử lý trước khi chuyển sang hàng việc chi tiết.",
  },
  lanh_dao: {
    title: "Ưu tiên ra quyết định",
    description: "Tập trung vào dữ liệu đã phê duyệt, điểm bất thường và các việc cần lãnh đạo xem trước.",
  },
  can_bo_thon: {
    title: "Bức tranh công việc của thôn",
    description: "Tách riêng phạm vi phụ trách và các chỉ số tổng quan trước khi đi vào từng việc được giao.",
  },
  to_cnscd: {
    title: "Bức tranh công việc hỗ trợ",
    description: "Tổng hợp phạm vi thôn được hỗ trợ và các chỉ số cần chú ý trước khi xử lý từng việc.",
  },
};

export default function OperationsCenter({ periodId, role, periods = EMPTY_PERIODS, maturityEnabled = false, onNavigate }: Props) {
  const [quality, setQuality] = useState<QualityResponse | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [drafts, setDrafts] = useState<DecisionDraft[]>([]);
  const [maturity, setMaturity] = useState<any[]>([]);
  const [initiatives, setInitiatives] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [actionOutcomes, setActionOutcomes] = useState<Record<string, string>>({});
  const [draftReviewNotes, setDraftReviewNotes] = useState<Record<string, string>>({});
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [draftReviewDecision, setDraftReviewDecision] = useState<
    "accepted" | "rejected" | null
  >(null);
  const [available, setAvailable] = useState<Availability>({
    quality: null,
    actions: null,
    drafts: null,
    maturity: null,
    initiatives: null,
    audit: null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshGenerationRef = useRef(0);
  const internal = role === "admin_xa" || role === "lanh_dao";
  const admin = role === "admin_xa";
  const copy = roleCopy[role] ?? roleCopy.can_bo_thon;
  const overviewCopy = roleOverviewCopy[role] ?? roleOverviewCopy.can_bo_thon;
  const qualityScopeLabel =
    role === "to_cnscd"
      ? "phạm vi hỗ trợ"
      : role === "can_bo_thon"
        ? "phạm vi phụ trách"
        : "phạm vi quyết định";

  const refresh = async (): Promise<boolean> => {
    const refreshGeneration = ++refreshGenerationRef.current;
    setLoading(true);
    setNotice(null);
    const load = async (key: LoadResult["key"], label: string, request: Promise<unknown>): Promise<LoadResult> => {
      try {
        return { key, label, value: await request };
      } catch (error) {
        return { key, label, value: null, error };
      }
    };
    const requests: Promise<LoadResult>[] = [
      load(
        "quality",
        "chất lượng dữ liệu",
        periodId
          ? apiJson(
              `/api/operations/quality?period_id=${encodeURIComponent(periodId)}`,
            )
          : Promise.resolve(null),
      ),
      load("actions", "danh sách việc", apiJson("/api/operations/actions")),
    ];
    if (internal) {
      requests.push(load("drafts", "bản tóm tắt hỗ trợ quyết định", apiJson("/api/operations/ai-drafts")));
    }
    if (admin) {
      requests.push(load("initiatives", "danh mục sáng kiến", apiJson("/api/operations/initiatives")));
      requests.push(
        load("audit", "nhật ký kiểm toán", apiJson("/auth/audit-logs")),
      );
      if (maturityEnabled) {
        requests.push(load("maturity", "đánh giá trưởng thành số", apiJson("/api/operations/maturity")));
      }
    }
    const results = await Promise.all(requests);
    if (refreshGeneration !== refreshGenerationRef.current) return false;
    setAvailable((current) => {
      const next = { ...current };
      for (const result of results) next[result.key] = !result.error;
      return next;
    });
    for (const result of results) {
      if (result.error) {
        if (result.key === "quality") setQuality(null);
        if (result.key === "actions") setActions([]);
        if (result.key === "drafts") setDrafts([]);
        if (result.key === "maturity") setMaturity([]);
        if (result.key === "initiatives") setInitiatives([]);
        if (result.key === "audit") setAuditEntries([]);
        continue;
      }
      if (result.key === "quality") setQuality(result.value as typeof quality);
      if (result.key === "actions") {
        setActions(
          Array.isArray(result.value)
            ? result.value.filter(isActionQueueItem)
            : [],
        );
      }
      if (result.key === "drafts") {
        setDrafts(
          Array.isArray(result.value)
            ? result.value.filter(isDecisionDraft)
            : [],
        );
      }
      if (result.key === "maturity") setMaturity(Array.isArray(result.value) ? result.value : []);
      if (result.key === "initiatives") setInitiatives(Array.isArray(result.value) ? result.value : []);
      if (result.key === "audit") {
        setAuditEntries(
          Array.isArray(result.value)
            ? result.value.filter(isAuditEntry).slice(0, 10)
            : [],
        );
      }
    }
    const failed = results.filter((result) => result.error).map((result) => result.label);
    if (failed.length) {
      setNotice(`Không tải được ${failed.join(", ")}. Các phần tải thành công vẫn được hiển thị; hãy thử lại sau.`);
    }
    setLoading(false);
    return true;
  };

  useEffect(() => {
    void refresh();
    return () => {
      refreshGenerationRef.current += 1;
    };
  }, [periodId, role, periods]);

  const orderedActions = useMemo(
    () => [...actions].sort(compareActionQueueItems),
    [actions],
  );
  const openActions = useMemo(() => actions.filter((item) => !["completed", "cancelled"].includes(item.status)), [actions]);
  const overdueActions = useMemo(() => openActions.filter((item) => item.due_state === "overdue"), [openActions]);
  const approvedReports = useMemo(() => (quality?.reports ?? []).filter((item) => !item.workflow_status || ["approved", "locked"].includes(item.workflow_status)), [quality]);
  const visibleQualityReports = useMemo(
    () => (role === "lanh_dao" ? approvedReports : quality?.reports ?? []),
    [approvedReports, quality, role],
  );
  const visibleQualityDimensions = useMemo(
    () => summarizeQualityDimensions(visibleQualityReports),
    [visibleQualityReports],
  );
  const flaggedReports = useMemo(
    () =>
      visibleQualityReports.filter(
        (item) => item.quality_status !== "ready",
      ),
    [visibleQualityReports],
  );
  const flaggedApprovedReports = useMemo(
    () => approvedReports.filter((item) => item.quality_status !== "ready"),
    [approvedReports],
  );
  const currentPeriodDrafts = useMemo(
    () =>
      drafts
        .filter((item) => item.period_id === periodId)
        .sort((left, right) => {
          const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
          const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
          return (
            (Number.isFinite(rightTime) ? rightTime : 0) -
            (Number.isFinite(leftTime) ? leftTime : 0)
          );
        }),
    [drafts, periodId],
  );
  const pendingDrafts = useMemo(() => currentPeriodDrafts.filter((item) => item.status === "pending_review"), [currentPeriodDrafts]);
  const officialAcceptedDrafts = useMemo(
    () => currentPeriodDrafts.filter(isOfficialAcceptedDraft),
    [currentPeriodDrafts],
  );
  const invalidAcceptedDrafts = useMemo(
    () =>
      currentPeriodDrafts.filter(
        (item) => item.status === "accepted" && !isOfficialAcceptedDraft(item),
      ),
    [currentPeriodDrafts],
  );
  const rejectedDrafts = useMemo(
    () => currentPeriodDrafts.filter((item) => item.status === "rejected"),
    [currentPeriodDrafts],
  );
  const latestDecisionDraft =
    (admin
      ? pendingDrafts[0] ?? officialAcceptedDrafts[0] ?? rejectedDrafts[0]
      : undefined) ?? officialAcceptedDrafts[0];
  const latestDraftMissingReviewMetadata = latestDecisionDraft
    ? isTerminalDraftMissingReviewMetadata(latestDecisionDraft)
    : false;
  const decisionHistorySource = admin
    ? currentPeriodDrafts
    : officialAcceptedDrafts;
  const decisionHistory = latestDecisionDraft
    ? decisionHistorySource.filter((item) => item.id !== latestDecisionDraft.id)
    : decisionHistorySource;
  const executiveMessage = approvedReports.length === 0 ? "Chưa có báo cáo đã phê duyệt để tạo kết luận điều hành; các bản đang xử lý chỉ dùng để theo dõi tiến độ." : overdueActions.length ? `${overdueActions.length} việc đã quá hạn cần xác định trách nhiệm và thời điểm hoàn thành.` : flaggedApprovedReports.length ? `${flaggedApprovedReports.length} báo cáo đã phê duyệt vẫn có điểm cần đối chiếu trước khi dùng làm căn cứ quyết định.` : openActions.length ? `${openActions.length} việc đang được theo dõi; chưa ghi nhận việc quá hạn.` : "Chưa ghi nhận việc quá hạn hoặc báo cáo cần rà soát trong phạm vi đang xem.";
  const generatedAt = quality?.generated_at ? new Date(quality.generated_at).toLocaleString("vi-VN") : "Chưa có thời điểm tổng hợp";
  const currentPeriodName =
    (available.quality === true && quality?.period?.id === periodId
      ? quality.period.name
      : undefined) ||
    periods.find((period) => period.id === periodId)?.display_name ||
    periods.find((period) => period.id === periodId)?.name ||
    "Kỳ đang chọn";
  const sourceSummary = Array.from(new Set(approvedReports.map((item) => reportSourceLabels[item.lineage.report_source] ?? "Nguồn khác"))).join(", ") || "Chưa có nguồn đã duyệt";
  const overdueOwners = Array.from(new Set(overdueActions.map((item) => item.owner_label))).join(", ") || "Chưa phân công";

  const updateAction = async (id: string, status: "in_progress" | "completed") => {
    const outcome = actionOutcomes[id]?.trim();
    if (status === "completed" && !outcome) {
      setNotice("Hãy ghi kết quả hoàn thành trước khi đóng công việc.");
      return;
    }
    const response = await apiFetch(`/api/operations/actions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, outcome: outcome || undefined }),
    });
    if (!response.ok) setNotice("Không thể cập nhật việc. Chỉ chủ việc hoặc quản trị xã được phép.");
    else {
      setActionOutcomes((current) => ({ ...current, [id]: "" }));
      void refresh();
    }
  };
  const createDraft = async () => {
    if (!admin || !periodId) return;
    setDraftBusy("create");
    try {
      const created = await apiJson("/api/operations/ai-drafts", {
        method: "POST",
        body: JSON.stringify({ period_id: periodId, kind: "period_brief" }),
      });
      if (
        !isDecisionDraft(created) ||
        created.period_id !== periodId ||
        created.status !== "pending_review"
      ) {
        setAvailable((current) => ({ ...current, drafts: false }));
        setNotice(
          "Bản có thể đã được tạo nhưng phản hồi không hợp lệ. Hãy tải lại trước khi thao tác tiếp.",
        );
        return;
      }
      setDrafts((current) => [
        created,
        ...current.filter((draft) => draft.id !== created.id),
      ]);
      setNotice("Đã tạo phân tích có căn cứ. Nội dung đang chờ người có thẩm quyền xem xét.");
    } catch (error) {
      setNotice(
        `Không thể tạo bản tóm tắt: ${toUserFacingError(
          error,
          "Không thể tạo bản tóm tắt hỗ trợ quyết định.",
        )}`,
      );
    } finally {
      setDraftBusy(null);
    }
  };
  const reviewDraft = async (id: string, decision: "accepted" | "rejected") => {
    const notes = draftReviewNotes[id]?.trim() || "";
    const currentDraft = drafts.find((draft) => draft.id === id);
    if (notes.length < 10) {
      setNotice("Không thể lưu quyết định: hãy ghi căn cứ nhận xét ít nhất 10 ký tự.");
      return;
    }
    setDraftBusy(id);
    setDraftReviewDecision(decision);
    try {
      const reviewed = await apiJson(`/api/operations/ai-drafts/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      });
      const validReviewedDraft =
        isDecisionDraft(reviewed) &&
        reviewed.id === id &&
        reviewed.status === decision &&
        reviewed.period_id === currentDraft?.period_id &&
        reviewed.review_notes === notes &&
        hasValidReviewMetadata(reviewed);
      if (!validReviewedDraft) {
        const refreshed = await refresh();
        if (refreshed) {
          setNotice(
            "Phản hồi duyệt không hợp lệ nên hệ thống đã tải lại dữ liệu nguồn. Hãy kiểm tra trạng thái trước khi thao tác tiếp.",
          );
        }
        return;
      }
      setDrafts((current) =>
        current.map((draft) => (draft.id === id ? reviewed : draft)),
      );
      setDraftReviewNotes((current) => ({ ...current, [id]: "" }));
      setNotice(
        decision === "accepted"
          ? "Đã chấp nhận bản tóm tắt và lưu căn cứ người duyệt."
          : "Đã từ chối bản tóm tắt và lưu căn cứ người duyệt.",
      );
    } catch (error) {
      setNotice(
        `Không thể lưu quyết định: ${toUserFacingError(
          error,
          "Không thể lưu quyết định duyệt bản tóm tắt.",
        )}`,
      );
    } finally {
      setDraftBusy(null);
      setDraftReviewDecision(null);
    }
  };

  const latestBriefSections = latestDecisionDraft
    ? parseDecisionBrief(latestDecisionDraft.content)
    : null;
  const latestCitations = asDraftCitations(latestDecisionDraft?.citations);
  const latestEvidenceCitations = latestCitations.filter(
    (citation) => citation.kind === "quality_snapshot",
  );
  const latestDecisionEvidence = latestCitations.filter(
    (citation) =>
      citation.kind === "quality_snapshot" ||
      citation.kind === "decision_metrics",
  );
  const latestDecisionMetrics = latestDecisionEvidence.find(
    (citation) => citation.kind === "decision_metrics",
  );
  const hasCompleteDecisionReportMetrics =
    typeof latestDecisionMetrics?.report_count === "number" &&
    typeof latestDecisionMetrics?.ready_report_count === "number" &&
    typeof latestDecisionMetrics?.blocked_report_count === "number" &&
    typeof latestDecisionMetrics?.review_report_count === "number";
  const hasKnownSnapshotStatuses =
    latestEvidenceCitations.length > 0 &&
    latestEvidenceCitations.every((citation) =>
      ["ready", "needs_review", "blocked"].includes(
        citation.quality_status || "",
      ),
    );
  const readyEvidenceCount = hasCompleteDecisionReportMetrics
    ? latestDecisionMetrics.ready_report_count
    : hasKnownSnapshotStatuses
      ? latestEvidenceCitations.filter(
          (citation) => citation.quality_status === "ready",
        ).length
      : null;
  const totalEvidenceCount = hasCompleteDecisionReportMetrics
    ? latestDecisionMetrics.report_count
    : hasKnownSnapshotStatuses
      ? latestEvidenceCitations.length
      : null;
  const reviewEvidenceCount = hasCompleteDecisionReportMetrics
    ? latestDecisionMetrics.blocked_report_count +
      latestDecisionMetrics.review_report_count
    : hasKnownSnapshotStatuses
      ? latestEvidenceCitations.filter(
          (citation) => citation.quality_status !== "ready",
        ).length
      : null;
  const latestAiCitation = latestCitations.find(
    (citation) => citation.kind === "ai_enrichment",
  );
  const latestAiStatus = latestCitations.find(
    (citation) => citation.kind === "ai_generation",
  );
  const latestAiAnalysis = isAiDecisionAnalysis(latestAiCitation?.analysis)
    ? latestAiCitation.analysis
    : undefined;
  const recommendedAiOption = latestAiAnalysis?.options.find(
    (option) => option.id === latestAiAnalysis.recommended_option_id,
  );
  const aiEvidenceLabels = new Map(
    latestDecisionEvidence
      .filter((citation) => citation.id)
      .map((citation) => [
        citation.id as string,
        citation.village_name || citation.label || "Căn cứ tổng hợp",
      ]),
  );
  const evidenceAnchorById = new Map(
    latestDecisionEvidence
      .filter((citation) => citation.id)
      .map((citation, index) => [
        citation.id as string,
        `decision-evidence-${latestDecisionDraft?.id || "draft"}-${index}`,
      ]),
  );
  const decisionEvidenceDetailsId = `decision-evidence-list-${
    latestDecisionDraft?.id || "draft"
  }`;
  const evidenceReadiness =
    latestDecisionMetrics?.generator_version === "deterministic-evidence-v3" &&
    typeof latestDecisionDraft?.confidence === "number"
      ? Math.round(latestDecisionDraft.confidence * 100)
      : null;
  const canCreateDecisionBrief =
    admin &&
    Boolean(periodId) &&
    available.quality === true &&
    available.drafts === true &&
    quality?.period?.id === periodId &&
    approvedReports.length > 0 &&
    pendingDrafts.length === 0 &&
    draftBusy === null;
  const decisionCreateUnavailableReason = !periodId
    ? "Hãy chọn kỳ báo cáo."
    : available.quality !== true ||
        available.drafts !== true ||
        quality?.period?.id !== periodId
      ? "Cần tải đủ dữ liệu đúng kỳ trước khi tạo."
      : !approvedReports.length
        ? "Chưa có báo cáo đã duyệt hoặc khóa."
        : pendingDrafts.length
          ? "Hãy thẩm định bản đang chờ trước khi tạo bản mới."
          : draftBusy !== null
            ? "Hệ thống đang xử lý yêu cầu hiện tại."
            : null;
  const openDecisionEvidence = (evidenceId?: string) => {
    const evidenceDetails = document.getElementById(decisionEvidenceDetailsId);
    if (evidenceDetails instanceof HTMLDetailsElement) {
      evidenceDetails.open = true;
    }
    const targetId = evidenceId
      ? evidenceAnchorById.get(evidenceId)
      : undefined;
    queueMicrotask(() => {
      const target = document.getElementById(
        targetId || decisionEvidenceDetailsId,
      );
      if (!(target instanceof HTMLElement)) return;
      target.focus({ preventScroll: true });
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView?.({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    });
  };

  if (loading)
    return (
      <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-800" />
        Đang tải không gian điều hành…
      </div>
    );

  return (
    <div className="operations-workspace space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            Làm mới
          </Button>
        }
      />
      {notice &&
        (notice.startsWith("Không") ? (
          <ErrorState description={notice} onRetry={() => void refresh()} />
        ) : (
          <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            {notice}
          </div>
        ))}

      <WorkSection
        id="operations-overview"
        index="01"
        title={overviewCopy.title}
        description={overviewCopy.description}
        tone="focus"
        icon={<Target />}
      >
        <DataScope period={quality?.period?.name || (periodId ? "Kỳ đang chọn" : "Chưa có kỳ")} scope={role === "can_bo_thon" ? "Thôn được phân công" : role === "to_cnscd" ? "Thôn được hỗ trợ" : "Toàn xã"} quality={quality?.rule_version ? `Bộ quy tắc ${quality.rule_version} · tổng hợp ${generatedAt}` : "Chưa có dữ liệu đánh giá"} qualityLabel="Đánh giá" />

        {internal && (
          <details className="executive-brief executive-brief--collapsible">
            <summary className="executive-brief__heading">
              <div>
                <p className="page-heading__eyebrow">Kết luận cần chú ý</p>
                <h2 id="executive-summary-title">Tóm tắt điều hành 60 giây</h2>
                <p>{executiveMessage}</p>
              </div>
              <StatusBadge status={overdueActions.length ? "overdue" : flaggedReports.length ? "needs_review" : "ready"} label={overdueActions.length ? "Cần xử lý ngay" : flaggedReports.length ? "Cần rà soát" : "Trong kiểm soát"} />
            </summary>
            <div className="executive-brief__details">
              <dl className="executive-brief__facts">
                <div>
                  <dt>
                    <CalendarDays aria-hidden="true" /> Kỳ dữ liệu
                  </dt>
                  <dd>{quality?.period?.name || "Chưa xác định"}</dd>
                </div>
                <div>
                  <dt>
                    <FileCheck2 aria-hidden="true" /> Dữ liệu đã phê duyệt
                  </dt>
                  <dd>{approvedReports.length} báo cáo</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 aria-hidden="true" /> Độ mới
                  </dt>
                  <dd>{generatedAt}</dd>
                </div>
                <div>
                  <dt>
                    <GitCompareArrows aria-hidden="true" /> So sánh qua kỳ
                  </dt>
                  <dd>Chưa bật — thiếu quy tắc đã phê duyệt</dd>
                </div>
                <div>
                  <dt>
                    <AlertTriangle aria-hidden="true" /> Việc quá hạn
                  </dt>
                  <dd>{available.actions === false ? "—" : overdueActions.length}</dd>
                </div>
                <div>
                  <dt>
                    <UserRoundCheck aria-hidden="true" /> Người phụ trách
                  </dt>
                  <dd>{overdueOwners}</dd>
                </div>
              </dl>
              <p className="executive-brief__note">Nguồn dữ liệu đã phê duyệt: {sourceSummary}. Hệ thống không tự giao việc, phê duyệt hoặc công bố.</p>
              {onNavigate && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => onNavigate("dashboard")}>
                    <Link2 />
                    Xem báo cáo và căn cứ
                  </Button>
                  <Button variant="secondary" onClick={() => onNavigate("progress-dashboard")}>
                    <Link2 />
                    Xem tiến độ các thôn
                  </Button>
                  <Button variant="secondary" onClick={() => onNavigate("cases")}>
                    <Link2 />
                    Xem công việc và cảnh báo
                  </Button>
                </div>
              )}
            </div>
          </details>
        )}

        <div className="work-section__metrics grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Việc đang mở" value={available.actions === false ? "—" : openActions.length} context={available.actions === false ? "Không tải được danh sách việc" : overdueActions.length ? `${overdueActions.length} việc đã quá hạn` : "Không có việc quá hạn"} tone={overdueActions.length ? "danger" : "success"} icon={<ClipboardList />} />
          <MetricCard
            label="Đầy đủ"
            value={
              available.quality === false
                ? "—"
                : formatDimensionPercent(
                    visibleQualityDimensions.completeness.percent,
                  )
            }
            context={
              available.quality === false
                ? "Không tải được bằng chứng đầy đủ"
                : visibleQualityDimensions.completeness.percent == null
                  ? "Chưa có bằng chứng; không quy đổi thành 0"
                  : `${visibleQualityDimensions.completeness.numerator}/${visibleQualityDimensions.completeness.denominator} trường · ${visibleQualityDimensions.completeness.reportsNeedingReview} báo cáo chưa đủ`
            }
            tone="info"
            icon={<DatabaseZap />}
          />
          <MetricCard
            label="Hợp lệ"
            value={
              available.quality === false
                ? "—"
                : formatDimensionPercent(
                    visibleQualityDimensions.validity.percent,
                  )
            }
            context={
              available.quality === false
                ? "Không tải được bằng chứng hợp lệ"
                : visibleQualityDimensions.validity.percent == null
                  ? "Chưa có bằng chứng; không quy đổi thành 0"
                  : `${visibleQualityDimensions.validity.numerator}/${visibleQualityDimensions.validity.denominator} báo cáo · ${visibleQualityDimensions.validity.reportsNeedingReview} có lỗi chặn`
            }
            tone={visibleQualityDimensions.validity.reportsNeedingReview ? "warning" : "success"}
            icon={<ShieldCheck />}
          />
          <MetricCard
            label="Đúng hạn"
            value={
              available.quality === false
                ? "—"
                : formatDimensionPercent(
                    visibleQualityDimensions.timeliness.percent,
                  )
            }
            context={
              available.quality === false
                ? "Không tải được bằng chứng đúng hạn"
                : visibleQualityDimensions.timeliness.percent == null
                  ? "Chưa có bằng chứng; không quy đổi thành 0"
                  : `${visibleQualityDimensions.timeliness.numerator}/${visibleQualityDimensions.timeliness.denominator} báo cáo · ${visibleQualityDimensions.timeliness.reportsNeedingReview} không đúng hạn`
            }
            tone={visibleQualityDimensions.timeliness.reportsNeedingReview ? "warning" : "success"}
            icon={<Clock3 />}
          />
          <MetricCard label="Báo cáo cần xem" value={available.quality === false ? "—" : flaggedReports.length} context={available.quality === false ? "Không xác định" : `${visibleQualityReports.length} báo cáo trong ${qualityScopeLabel}`} tone={flaggedReports.length ? "warning" : "success"} icon={<ShieldCheck />} />
          {admin ? (
            <MetricCard
              label="Bản tóm tắt chờ duyệt"
              value={available.drafts === false ? "—" : pendingDrafts.length}
              context={
                available.drafts === false
                  ? "Không tải được bản tóm tắt"
                  : "Có căn cứ và nhận xét người duyệt"
              }
              tone="neutral"
              icon={<BrainCircuit />}
            />
          ) : role === "lanh_dao" ? (
            <MetricCard
              label="Bản tóm tắt đã duyệt"
              value={
                available.drafts === false
                  ? "—"
                  : officialAcceptedDrafts.length
              }
              context={
                available.drafts === false
                  ? "Không tải được bản tóm tắt"
                  : "Chỉ tính hồ sơ đã được quản trị xã chấp nhận"
              }
              tone="neutral"
              icon={<BrainCircuit />}
            />
          ) : (
            <MetricCard
              label="Báo cáo trong phạm vi"
              value={
                available.quality === false
                  ? "—"
                  : (quality?.reports?.length ?? "—")
              }
              context="Không cộng dữ liệu ngoài quyền"
              tone="neutral"
              icon={<Target />}
            />
          )}
        </div>
      </WorkSection>

      <WorkSection
        id="operations-tasks"
        tabIndex={-1}
        index="02"
        title="Hàng việc cần xử lý"
        description="Xếp việc quá hạn lên trước; mỗi thẻ nêu người phụ trách, ưu tiên, tuổi việc, hạn xử lý, căn cứ và hành động được phép."
        tone="tasks"
        icon={<ClipboardList />}
      >
        <div className="work-section__list space-y-3">
          {available.actions === false ? (
            <ErrorState title="Chưa tải được danh sách việc" description="Các chỉ số khác vẫn dùng được. Hãy thử tải lại danh sách việc." onRetry={() => void refresh()} />
          ) : (
            <>
              {!actions.length && <EmptyState title="Chưa có việc được phân công" description="Việc mới sẽ xuất hiện tại đây cùng người phụ trách và thời hạn xử lý." />}
              {orderedActions.map((item) => {
                const ageLabel =
                  item.age_days === 0 ? "tạo hôm nay" : `${item.age_days} ngày`;
                return (
                  <ActionCard
                    key={item.id}
                    title={item.title}
                    meta={
                      <span>
                        Phụ trách: {item.owner_label} · Ưu tiên{" "}
                        {priorityLabels[item.priority]} · Tuổi việc {ageLabel} ·{" "}
                        {actionDueLabels[item.due_state]}
                        {item.due_date
                          ? ` ${new Date(`${item.due_date}T00:00:00`).toLocaleDateString("vi-VN")}`
                          : ""}
                        {" · "}
                        Căn cứ: {actionEvidenceLabels[item.evidence_status]} · Nguồn:{" "}
                        {actionSourceLabels[item.source_type]}
                      </span>
                    }
                    status={
                      <StatusBadge
                        status={
                          item.due_state === "overdue"
                            ? "overdue"
                            : item.status
                        }
                      />
                    }
                  >
                    {item.next_action === "start" && (
                      <Button variant="secondary" onClick={() => void updateAction(item.id, "in_progress")}>
                        Nhận việc
                      </Button>
                    )}
                    {item.next_action === "complete" && (
                      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
                        <label className="flex-1 text-sm font-semibold text-slate-700">
                          Kết quả hoàn thành
                          <input
                            className="mt-1 w-full"
                            maxLength={2000}
                            value={actionOutcomes[item.id] || ""}
                            onChange={(event) =>
                              setActionOutcomes((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                            placeholder="Nêu kết quả và căn cứ kiểm tra…"
                          />
                        </label>
                        <Button disabled={!actionOutcomes[item.id]?.trim()} onClick={() => void updateAction(item.id, "completed")}>
                          <CheckCircle2 />
                          Hoàn tất
                        </Button>
                      </div>
                    )}
                  </ActionCard>
                );
              })}
            </>
          )}
        </div>
      </WorkSection>

      <WorkSection
        id="operations-evidence"
        tabIndex={-1}
        index="03"
        title="Dữ liệu cần rà soát"
        description="Tách riêng bằng chứng dữ liệu khỏi hàng việc; mỗi dòng cho biết chất lượng, cảnh báo, nguồn nhập và phiên bản."
        tone="evidence"
        icon={<ShieldCheck />}
      >
        <div className="work-table-shell overflow-x-auto">
          {available.quality === false ? (
            <div className="p-5">
              <ErrorState title="Chưa tải được chất lượng dữ liệu" description="Không hiển thị số 0 thay cho dữ liệu chưa tải được." onRetry={() => void refresh()} />
            </div>
          ) : (
            <>
              <table className="operations-quality-table">
                <caption className="sr-only">
                  Bằng chứng chất lượng theo báo cáo: đầy đủ, hợp lệ, đúng hạn,
                  cảnh báo, nguồn và phiên bản
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Thôn</th>
                    <th scope="col">Đầy đủ</th>
                    <th scope="col">Hợp lệ</th>
                    <th scope="col">Đúng hạn</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Cần xem</th>
                    <th scope="col">Nguồn và phiên bản</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQualityReports.map((item) => (
                    <tr key={item.report_id}>
                      <th scope="row" className="font-semibold">
                        {item.village_name}
                      </th>
                      <td>
                        {typeof item.completeness_numerator === "number" &&
                        typeof item.completeness_denominator === "number"
                          ? `${item.completeness_numerator}/${item.completeness_denominator} trường · ${formatDimensionPercent(item.completeness_percent)}`
                          : "— · chưa có bằng chứng"}
                      </td>
                      <td>
                        {typeof item.validity_percent === "number"
                          ? `${formatDimensionPercent(item.validity_percent)} · ${item.blocking_flag_count ?? "—"} lỗi chặn`
                          : "— · chưa có bằng chứng"}
                      </td>
                      <td>
                        {timelinessLabels[item.timeliness_status || ""] ||
                          "— · chưa có bằng chứng"}
                      </td>
                      <td>
                        <StatusBadge status={item.quality_status} />
                      </td>
                      <td>
                        {item.unresolved_flag_count} lỗi · {item.outlier_count} bất thường
                      </td>
                      <td>
                        {reportSourceLabels[item.lineage.report_source] ?? "Nguồn khác"} · phiên bản {item.lineage.report_version}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleQualityReports.length && <EmptyState title="Chưa có báo cáo để đánh giá" description="Dữ liệu chất lượng sẽ xuất hiện sau khi kỳ báo cáo có bản ghi trong phạm vi quyết định." />}
            </>
          )}
        </div>
        {admin && (
          <section
            aria-labelledby="operations-audit-title"
            className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3
                  id="operations-audit-title"
                  className="font-bold text-slate-900"
                >
                  Dấu vết kiểm soát gần nhất
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Đối chiếu thao tác, đối tượng, mã bản ghi, người thực hiện và
                  thời điểm. Chi tiết nội bộ không được lặp lại trên bảng tổng
                  quan.
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-slate-500">
                Tối đa 10 bản ghi mới nhất
              </span>
            </div>
            {available.audit === false ? (
              <div className="mt-4">
                <ErrorState
                  title="Chưa tải được nhật ký kiểm toán"
                  description="Bằng chứng chất lượng vẫn được giữ nguyên; thử tải lại nhật ký trước khi kết luận về thao tác gần nhất."
                  onRetry={() => void refresh()}
                />
              </div>
            ) : auditEntries.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="operations-quality-table">
                  <caption className="sr-only">
                    Mười bản ghi kiểm toán mới nhất gồm thời gian, thao tác, đối
                    tượng, mã bản ghi và người thực hiện
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Thời gian</th>
                      <th scope="col">Thao tác</th>
                      <th scope="col">Đối tượng</th>
                      <th scope="col">Mã bản ghi</th>
                      <th scope="col">Người thực hiện</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {new Date(entry.created_at).toLocaleString("vi-VN", {
                            timeZone: "Asia/Ho_Chi_Minh",
                          })}
                        </td>
                        <td>
                          {auditActionLabel(entry.action)}
                        </td>
                        <td>
                          {auditObjectLabel(entry.table_name)}
                        </td>
                        <td className="font-mono">
                          {shortAuditReference(entry.record_id)}
                        </td>
                        <td>
                          {entry.user_id
                            ? `Tài khoản ${shortAuditReference(entry.user_id)}`
                            : "Hệ thống"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title="Chưa có dấu vết kiểm toán"
                  description="Nhật ký sẽ xuất hiện sau khi hệ thống ghi nhận thao tác quản trị hoặc thay đổi dữ liệu."
                />
              </div>
            )}
          </section>
        )}
      </WorkSection>

      {internal && (
        <WorkSection
          id="operations-support"
          index="04"
          title="Nội dung hỗ trợ quyết định"
          description="Luật xác định chốt số liệu; AI phân tích phương án, đánh đổi và rủi ro có dẫn chứng. Người có thẩm quyền phải ghi nhận xét trước khi chấp nhận hoặc từ chối."
          tone="support"
          icon={<BrainCircuit />}
          actions={
            admin ? (
              <div className="decision-create-action">
                <Button
                  onClick={() => void createDraft()}
                  disabled={!canCreateDecisionBrief}
                  title={decisionCreateUnavailableReason || undefined}
                  aria-describedby={
                    decisionCreateUnavailableReason
                      ? "decision-create-status"
                      : undefined
                  }
                >
                  {draftBusy === "create" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Sparkles />
                  )}
                  {pendingDrafts.length
                    ? "Đang chờ duyệt"
                    : "Tạo bản phân tích có căn cứ"}
                </Button>
                {decisionCreateUnavailableReason && (
                  <span id="decision-create-status" role="status">
                    {decisionCreateUnavailableReason}
                  </span>
                )}
              </div>
            ) : undefined
          }
        >
          <div className="decision-workspace">
            <div role="note" className="decision-human-note">
              <ShieldCheck />
              <div>
                <p>Con người giữ quyền quyết định</p>
                <p>
                  Luật xác định vẫn chốt chất lượng và mức ưu tiên từ báo cáo đã
                  duyệt/khóa. AI chỉ đề xuất phương án trên gói dữ liệu tổng hợp
                  không có PII; không tự phê duyệt, giao việc hoặc công bố số liệu.
                </p>
              </div>
            </div>

            {available.drafts === false ? (
              <ErrorState title="Chưa tải được bản tóm tắt" description="Phần việc và chất lượng dữ liệu không bị ảnh hưởng." onRetry={() => void refresh()} />
            ) : !latestDecisionDraft || !latestBriefSections ? (
              <EmptyState
                title={
                  !admin
                    ? "Chưa có bản đã chấp nhận cho kỳ này"
                    : invalidAcceptedDrafts.length
                      ? "Chưa có hồ sơ được chấp nhận hợp lệ"
                      : "Chưa có bản phân tích cho kỳ này"
                }
                description={
                  admin && invalidAcceptedDrafts.length
                    ? "Hồ sơ di sản thiếu căn cứ duyệt chỉ được giữ trong lịch sử để truy vết; không dùng làm căn cứ chính thức."
                    : approvedReports.length && admin
                    ? "Quản trị xã có thể tạo một bản phân tích có căn cứ để người có thẩm quyền xem xét."
                    : approvedReports.length
                      ? "Quản trị xã chưa tạo và chấp nhận bản phân tích cho kỳ này."
                    : "Cần ít nhất một báo cáo đã duyệt hoặc khóa; bản đang xử lý không được dùng làm căn cứ quyết định."
                }
              />
            ) : (
              <>
                <article className="decision-support-card">
                  <header className="decision-record-header">
                    <div className="decision-record-header__copy">
                      <p className="decision-support-kicker">
                        {latestDecisionDraft.status === "pending_review"
                          ? "Hồ sơ đang chờ bạn thẩm định"
                          : latestDecisionDraft.status === "accepted"
                            ? "Hồ sơ đã được chấp nhận gần nhất"
                            : "Hồ sơ đã bị từ chối gần nhất"}
                      </p>
                      <h3>
                        Hồ sơ hỗ trợ quyết định ·{" "}
                        {currentPeriodName}
                      </h3>
                      <p>
                        {latestDecisionDraft.created_at
                          ? `Tạo lúc ${new Date(
                              latestDecisionDraft.created_at,
                            ).toLocaleString("vi-VN")}`
                          : "Chưa có thời điểm tạo"}
                        {" · "}
                        {latestAiAnalysis
                          ? "Luật xác định + AI tham khảo"
                          : "Luật xác định"}
                      </p>
                    </div>
                    <div className="decision-record-header__status">
                      <StatusBadge
                        status={
                          latestDraftMissingReviewMetadata
                            ? "needs_revision"
                            : latestDecisionDraft.status
                        }
                        label={
                          latestDraftMissingReviewMetadata
                            ? "Thiếu căn cứ duyệt"
                            : undefined
                        }
                      />
                      <span className="decision-support-priority">
                        Mức ưu tiên: {latestBriefSections.priority}
                      </span>
                    </div>
                  </header>

                  <ol
                    className="decision-review-flow"
                    aria-label={
                      admin
                        ? "Ba bước thẩm định hồ sơ"
                        : "Ba bước sử dụng hồ sơ đã chấp nhận"
                    }
                  >
                    <li>
                      <span>01</span>
                      <div>
                        <strong>Đọc kết luận xác định</strong>
                        <small>Chốt từ dữ liệu đã duyệt và bộ quy tắc</small>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>Đối chiếu căn cứ</strong>
                        <small>Kiểm tra nguồn, phiên bản, phương án và rủi ro</small>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>
                          {admin
                            ? "Ghi nhận kết quả thẩm định"
                            : "Dùng đúng phạm vi điều hành"}
                        </strong>
                        <small>
                          {admin
                            ? "Nêu rõ lý do chấp nhận hoặc từ chối"
                            : "Không xem nội dung AI là quyết định tự động"}
                        </small>
                      </div>
                    </li>
                  </ol>

                  <div className="decision-focus-grid">
                    <section
                      className="decision-focus-card decision-focus-card--conclusion"
                      aria-labelledby={`decision-conclusion-${latestDecisionDraft.id}`}
                    >
                      <Target aria-hidden="true" />
                      <div>
                        <h4 id={`decision-conclusion-${latestDecisionDraft.id}`}>
                          Kết luận cần xem xét
                        </h4>
                        <p>{latestBriefSections.conclusion}</p>
                      </div>
                    </section>
                    <section
                      className="decision-focus-card decision-focus-card--action"
                      aria-labelledby={`decision-action-${latestDecisionDraft.id}`}
                    >
                      <GitCompareArrows aria-hidden="true" />
                      <div>
                        <h4 id={`decision-action-${latestDecisionDraft.id}`}>
                          Việc nên làm tiếp theo
                        </h4>
                        <p>{latestBriefSections.action}</p>
                      </div>
                    </section>
                  </div>

                  <div className="decision-context-grid">
                    <section
                      aria-labelledby={`decision-basis-${latestDecisionDraft.id}`}
                    >
                      <h4 id={`decision-basis-${latestDecisionDraft.id}`}>
                        Căn cứ định lượng
                      </h4>
                      <p>{latestBriefSections.basis}</p>
                    </section>
                    <section
                      aria-labelledby={`decision-limit-${latestDecisionDraft.id}`}
                    >
                      <h4 id={`decision-limit-${latestDecisionDraft.id}`}>
                        Giới hạn sử dụng
                      </h4>
                      <p>{latestBriefSections.limitation}</p>
                    </section>
                  </div>

                  <dl
                    className="decision-evidence-summary"
                    aria-label="Tóm tắt căn cứ tại thời điểm tạo hồ sơ"
                  >
                    <div>
                      <dt>Báo cáo đạt điều kiện</dt>
                      <dd>
                        {readyEvidenceCount !== null &&
                        totalEvidenceCount !== null
                          ? `${readyEvidenceCount}/${totalEvidenceCount}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Báo cáo cần xem</dt>
                      <dd>{reviewEvidenceCount ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Việc đang mở</dt>
                      <dd>{latestDecisionMetrics?.open_action_count ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Việc quá hạn</dt>
                      <dd>{latestDecisionMetrics?.overdue_action_count ?? "—"}</dd>
                    </div>
                  </dl>

                  <div className="decision-navigation">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const target =
                          document.getElementById("operations-evidence");
                        const reduceMotion =
                          typeof window.matchMedia === "function" &&
                          window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches;
                        target?.scrollIntoView?.({
                          behavior: reduceMotion ? "auto" : "smooth",
                          block: "start",
                        });
                        target?.focus({ preventScroll: true });
                      }}
                    >
                      <FileCheck2 />
                      Đối chiếu dữ liệu gốc
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const target =
                          document.getElementById("operations-tasks");
                        const reduceMotion =
                          typeof window.matchMedia === "function" &&
                          window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches;
                        target?.scrollIntoView?.({
                          behavior: reduceMotion ? "auto" : "smooth",
                          block: "start",
                        });
                        target?.focus({ preventScroll: true });
                      }}
                    >
                      <ClipboardList />
                      Mở hàng việc liên quan
                    </Button>
                  </div>

                  <details
                    id={decisionEvidenceDetailsId}
                    className="decision-evidence-disclosure"
                    tabIndex={-1}
                  >
                    <summary>
                      <FileCheck2 aria-hidden="true" />
                      <span>
                        <strong>Căn cứ có thể truy ngược</strong>
                        <small>
                          {latestEvidenceCitations.length} báo cáo nguồn
                          {latestDecisionMetrics
                            ? " · 1 gói chỉ số tổng hợp"
                            : ""}
                        </small>
                      </span>
                      <span aria-hidden="true">Xem chi tiết</span>
                    </summary>
                    <div className="decision-evidence-list">
                      {latestDecisionEvidence.length ? (
                        latestDecisionEvidence.map((citation, index) => {
                          const evidenceId =
                            citation.id ||
                            `citation-${latestDecisionDraft.id}-${index}`;
                          const anchorId =
                            (citation.id &&
                              evidenceAnchorById.get(citation.id)) ||
                            `decision-evidence-${latestDecisionDraft.id}-${index}`;
                          return (
                            <article
                              key={`${evidenceId}-${index}`}
                              id={anchorId}
                              tabIndex={-1}
                              className="decision-evidence-card"
                            >
                              <div className="decision-evidence-card__heading">
                                <span>
                                  {citation.kind === "decision_metrics"
                                    ? "Chỉ số tổng hợp"
                                    : "Báo cáo nguồn"}
                                </span>
                                <code>{evidenceId}</code>
                              </div>
                              <h5>
                                {citation.village_name ||
                                  citation.label ||
                                  "Căn cứ đã ghi nhận"}
                              </h5>
                              {citation.kind === "decision_metrics" ? (
                                <p>
                                  {typeof citation.report_count === "number"
                                    ? `${citation.report_count} báo cáo`
                                    : "Số báo cáo chưa ghi nhận"}
                                  {typeof citation.complete_field_count ===
                                    "number" &&
                                  typeof citation.expected_field_count ===
                                    "number"
                                    ? ` · đầy đủ ${citation.complete_field_count}/${citation.expected_field_count} trường`
                                    : ""}
                                  {typeof citation.valid_report_count ===
                                    "number" &&
                                  typeof citation.report_count === "number"
                                    ? ` · hợp lệ ${citation.valid_report_count}/${citation.report_count}`
                                    : ""}
                                  {typeof citation.timely_report_count ===
                                    "number" &&
                                  typeof citation.report_count === "number"
                                    ? ` · đúng hạn ${citation.timely_report_count}/${citation.report_count}`
                                    : ""}
                                  {typeof citation.late_report_count === "number"
                                    ? ` · ${citation.late_report_count} báo cáo nộp muộn`
                                    : ""}
                                </p>
                              ) : (
                                <p>
                                  {typeof citation.completeness_numerator ===
                                    "number" &&
                                  typeof citation.completeness_denominator ===
                                    "number"
                                    ? `Đầy đủ ${citation.completeness_numerator}/${citation.completeness_denominator} trường (${formatDimensionPercent(citation.completeness_percent)})`
                                    : "Chưa có bằng chứng đầy đủ"}
                                  {typeof citation.validity_percent === "number"
                                    ? ` · hợp lệ ${formatDimensionPercent(citation.validity_percent)}`
                                    : ""}
                                  {typeof citation.blocking_flag_count ===
                                  "number"
                                    ? ` · ${citation.blocking_flag_count} lỗi chặn`
                                    : ""}
                                  {citation.timeliness_status
                                    ? ` · ${timelinessLabels[citation.timeliness_status] || citation.timeliness_status}`
                                    : ""}
                                  {typeof citation.unresolved_flag_count ===
                                  "number"
                                    ? ` · ${citation.unresolved_flag_count} cảnh báo`
                                    : ""}
                                  {typeof citation.outlier_count === "number"
                                    ? ` · ${citation.outlier_count} bất thường`
                                    : ""}
                                  {citation.report_source
                                    ? ` · ${
                                        reportSourceLabels[
                                          citation.report_source
                                        ] || "Nguồn đã ghi nhận"
                                      }`
                                    : ""}
                                  {citation.report_version
                                    ? ` · phiên bản ${citation.report_version}`
                                    : ""}
                                </p>
                              )}
                              <div className="decision-evidence-card__provenance">
                                {citation.rule_version && (
                                  <span>Bộ quy tắc {citation.rule_version}</span>
                                )}
                                {citation.generator_version && (
                                  <span>
                                    Bộ tạo {citation.generator_version}
                                  </span>
                                )}
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <p className="decision-evidence-empty">
                          Bản cũ chưa có căn cứ chi tiết; hãy tạo lại sau khi dữ
                          liệu thay đổi.
                        </p>
                      )}
                    </div>
                  </details>

                  {latestAiAnalysis ? (
                    <details className="decision-ai-disclosure">
                      <summary>
                        <Sparkles aria-hidden="true" />
                        <span>
                          <strong>Phân tích AI tham khảo</strong>
                          <small>
                            {latestAiAnalysis.options.length} phương án ·{" "}
                            {latestAiAnalysis.risks.length} rủi ro ·{" "}
                            {latestAiAnalysis.reviewer_questions.length} câu hỏi
                          </small>
                        </span>
                        <span aria-hidden="true">Mở để xem xét</span>
                      </summary>
                      <section
                        className="decision-ai"
                        aria-labelledby={`decision-ai-title-${latestDecisionDraft.id}`}
                      >
                        <header className="decision-ai__header">
                          <div className="decision-ai__meta">
                            <span className="decision-ai__badge">
                              <Sparkles aria-hidden="true" />
                              AI phân tích trên gói căn cứ đã giới hạn
                            </span>
                          </div>
                          <h4
                            id={`decision-ai-title-${latestDecisionDraft.id}`}
                            className="decision-ai__title"
                          >
                            Nhận định để tham khảo
                          </h4>
                          <p className="decision-ai__assessment">
                            {latestAiAnalysis.executive_assessment}
                          </p>
                        </header>

                        <div className="decision-ai__body">
                          <section
                            aria-labelledby={`decision-options-${latestDecisionDraft.id}`}
                          >
                            <div className="decision-ai__section-heading">
                              <div>
                                <h5
                                  id={`decision-options-${latestDecisionDraft.id}`}
                                  className="decision-ai__eyebrow"
                                >
                                  Các phương án để người duyệt cân nhắc
                                </h5>
                                {recommendedAiOption && (
                                  <p className="decision-ai__hint">
                                    AI đánh dấu phương án{" "}
                                    {recommendedAiOption.id} để ưu tiên xem xét;
                                    đây không phải quyết định.
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="decision-ai__options">
                              {latestAiAnalysis.options.map((option) => {
                                const recommended =
                                  option.id ===
                                  latestAiAnalysis.recommended_option_id;
                                return (
                                  <article
                                    key={option.id}
                                    className={`decision-ai__option ${
                                      recommended
                                        ? "decision-ai__option--recommended"
                                        : ""
                                    }`}
                                  >
                                    <div className="decision-ai__option-header">
                                      <span className="decision-ai__option-id">
                                        {option.id}
                                      </span>
                                      <div className="decision-ai__option-tags">
                                        {recommended && (
                                          <span className="decision-ai__recommended">
                                            AI đề xuất
                                          </span>
                                        )}
                                        <span className="decision-ai__urgency">
                                          {aiUrgencyLabels[option.urgency]}
                                        </span>
                                      </div>
                                    </div>
                                    <h6 className="decision-ai__option-title">
                                      {option.title}
                                    </h6>
                                    <p className="decision-ai__option-copy">
                                      {option.rationale}
                                    </p>
                                    <div className="decision-ai__tradeoff">
                                      <p className="decision-ai__tradeoff-label">
                                        Đánh đổi cần chấp nhận
                                      </p>
                                      <p>{option.tradeoff}</p>
                                    </div>
                                    {option.evidence_ids.length > 0 && (
                                      <div className="decision-ai__evidence">
                                        {option.evidence_ids.map(
                                          (evidenceId) => {
                                            const evidenceLabel =
                                              aiEvidenceLabels.get(evidenceId);
                                            return (
                                              <button
                                                key={evidenceId}
                                                type="button"
                                                className="decision-ai__evidence-chip"
                                                onClick={() =>
                                                  openDecisionEvidence(evidenceId)
                                                }
                                                aria-label={`Mở căn cứ ${
                                                  evidenceLabel ||
                                                  "không còn trong hồ sơ"
                                                } (${evidenceId})`}
                                              >
                                                <Link2 aria-hidden="true" />
                                                {evidenceLabel ||
                                                  "Mã căn cứ không còn trong hồ sơ"}
                                              </button>
                                            );
                                          },
                                        )}
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          </section>

                          <div className="decision-ai__review-grid">
                            <section
                              className="decision-ai__risks"
                              aria-labelledby={`decision-risks-${latestDecisionDraft.id}`}
                            >
                              <h5
                                id={`decision-risks-${latestDecisionDraft.id}`}
                                className="decision-ai__eyebrow"
                              >
                                Rủi ro và cách giảm thiểu
                              </h5>
                              <div className="decision-ai__risk-list">
                                {latestAiAnalysis.risks.map((risk) => (
                                  <article
                                    key={`${risk.severity}-${risk.title}`}
                                  >
                                    <div className="decision-ai__risk-heading">
                                      <h6>{risk.title}</h6>
                                      <span>
                                        {aiSeverityLabels[risk.severity]}
                                      </span>
                                    </div>
                                    <p className="decision-ai__risk-copy">
                                      {risk.mitigation}
                                    </p>
                                    {risk.evidence_ids.length > 0 && (
                                      <div className="decision-ai__evidence">
                                        {risk.evidence_ids.map((evidenceId) => {
                                          const evidenceLabel =
                                            aiEvidenceLabels.get(evidenceId);
                                          return (
                                            <button
                                              key={evidenceId}
                                              type="button"
                                              className="decision-ai__evidence-chip"
                                              onClick={() =>
                                                openDecisionEvidence(evidenceId)
                                              }
                                              aria-label={`Mở căn cứ ${
                                                evidenceLabel ||
                                                "không còn trong hồ sơ"
                                              } (${evidenceId})`}
                                            >
                                              <Link2 aria-hidden="true" />
                                              {evidenceLabel ||
                                                "Mã căn cứ không còn trong hồ sơ"}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </article>
                                ))}
                              </div>
                            </section>
                            <section
                              className="decision-ai__questions"
                              aria-labelledby={`decision-questions-${latestDecisionDraft.id}`}
                            >
                              <h5
                                id={`decision-questions-${latestDecisionDraft.id}`}
                                className="decision-ai__eyebrow"
                              >
                                Câu hỏi phản biện trước khi duyệt
                              </h5>
                              <ul>
                                {latestAiAnalysis.reviewer_questions.map(
                                  (question) => (
                                    <li key={question}>
                                      <span aria-hidden="true">?</span>
                                      <span>{question}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </section>
                          </div>

                          <details className="decision-ai__assumptions">
                            <summary>
                              Nguồn gốc và giả định AI (
                              {latestAiAnalysis.assumptions.length})
                            </summary>
                            <div className="decision-ai__provenance">
                              <p>
                                Mô hình:{" "}
                                {latestAiCitation?.model ||
                                  "Mô hình đã cấu hình"}
                                {" · "}
                                Phiên bản prompt:{" "}
                                {latestAiCitation?.prompt_version ||
                                  "phiên bản kiểm soát"}
                              </p>
                              {evidenceReadiness !== null && (
                                <p>
                                  Chỉ số kỹ thuật sẵn sàng dữ liệu{" "}
                                  {evidenceReadiness}% = tỷ lệ báo cáo đạt đồng
                                  thời đủ trường, không có lỗi chặn và đúng hạn.
                                  Đây không phải xác suất AI đúng.
                                </p>
                              )}
                            </div>
                            {latestAiAnalysis.assumptions.length > 0 ? (
                              <ul>
                                {latestAiAnalysis.assumptions.map(
                                  (assumption) => (
                                    <li key={assumption}>{assumption}</li>
                                  ),
                                )}
                              </ul>
                            ) : (
                              <p>AI không ghi thêm giả định cho bản này.</p>
                            )}
                          </details>
                        </div>
                      </section>
                    </details>
                  ) : (
                    <div className="decision-ai-fallback" role="note">
                      <Sparkles aria-hidden="true" />
                      <div>
                        <p>Bản an toàn bằng luật xác định</p>
                        <p>
                          {latestAiCitation
                            ? "Phần AI có cấu trúc không hợp lệ nên đã được ẩn. Kết luận và căn cứ xác định vẫn giữ nguyên để người có thẩm quyền rà soát."
                            : latestAiStatus?.label ||
                              "AI chưa được bật cho bản này; kết luận và căn cứ định lượng vẫn dùng được để rà soát."}
                        </p>
                      </div>
                    </div>
                  )}

                  {latestDecisionDraft.status === "pending_review" && admin && (
                    <section
                      className="decision-support-review"
                      aria-labelledby={`draft-review-title-${latestDecisionDraft.id}`}
                    >
                      <header className="decision-support-review__header">
                        <UserRoundCheck aria-hidden="true" />
                        <div>
                          <h4
                            id={`draft-review-title-${latestDecisionDraft.id}`}
                          >
                            Ghi nhận quyết định của người duyệt
                          </h4>
                          <p
                            id={`draft-review-help-${latestDecisionDraft.id}`}
                          >
                            Đối chiếu dữ liệu nguồn, cân nhắc phương án và rủi
                            ro, sau đó ghi rõ lý do chấp nhận hoặc từ chối.
                          </p>
                        </div>
                      </header>
                      <label
                        htmlFor={`draft-review-${latestDecisionDraft.id}`}
                        className="decision-support-review__label"
                      >
                        Căn cứ nhận xét
                      </label>
                      <textarea
                        id={`draft-review-${latestDecisionDraft.id}`}
                        aria-describedby={`draft-review-help-${latestDecisionDraft.id} draft-review-count-${latestDecisionDraft.id}`}
                        value={draftReviewNotes[latestDecisionDraft.id] || ""}
                        onChange={(event) =>
                          setDraftReviewNotes((current) => ({
                            ...current,
                            [latestDecisionDraft.id]: event.target.value,
                          }))
                        }
                        maxLength={2000}
                        rows={3}
                        placeholder="Nêu tài liệu đã kiểm tra, điểm đồng ý hoặc lý do chưa chấp nhận (ít nhất 10 ký tự)…"
                        className="decision-support-review__input"
                      />
                      <div className="decision-support-review__footer">
                        <span
                          id={`draft-review-count-${latestDecisionDraft.id}`}
                          className="decision-support-review__count"
                        >
                          {(draftReviewNotes[
                            latestDecisionDraft.id
                          ]?.trim().length || 0) >= 10
                            ? "Đủ độ dài tối thiểu"
                            : `Cần thêm ${
                                10 -
                                (draftReviewNotes[
                                  latestDecisionDraft.id
                                ]?.trim().length || 0)
                              } ký tự nội dung`}
                          {" · "}
                          {(draftReviewNotes[latestDecisionDraft.id] || "").length}
                          /2000
                        </span>
                        <div className="decision-support-review__actions">
                        <Button
                          variant="danger"
                          disabled={
                            (draftReviewNotes[latestDecisionDraft.id]?.trim().length || 0) < 10 ||
                            draftBusy === latestDecisionDraft.id
                          }
                          onClick={() =>
                            void reviewDraft(latestDecisionDraft.id, "rejected")
                          }
                        >
                          {draftBusy === latestDecisionDraft.id &&
                            draftReviewDecision === "rejected" && (
                              <Loader2 className="animate-spin" />
                            )}
                          Từ chối bản phân tích
                        </Button>
                        <Button
                          disabled={
                            (draftReviewNotes[latestDecisionDraft.id]?.trim().length || 0) < 10 ||
                            draftBusy === latestDecisionDraft.id
                          }
                          onClick={() =>
                            void reviewDraft(latestDecisionDraft.id, "accepted")
                          }
                        >
                          {draftBusy === latestDecisionDraft.id &&
                            draftReviewDecision === "accepted" && (
                              <Loader2 className="animate-spin" />
                            )}
                          Chấp nhận làm tài liệu tham khảo
                        </Button>
                        </div>
                      </div>
                    </section>
                  )}

                  {latestDraftMissingReviewMetadata && (
                    <section className="decision-recorded-review">
                      <h4>Cảnh báo kiểm toán</h4>
                      <p role="note">
                        Hồ sơ lịch sử thiếu căn cứ duyệt; không dùng làm căn cứ
                        chính thức
                      </p>
                    </section>
                  )}

                  {latestDecisionDraft.status !== "pending_review" &&
                    latestDecisionDraft.review_notes && (
                      <section className="decision-recorded-review">
                        <h4>Nhận xét đã lưu</h4>
                        <p>
                          {latestDecisionDraft.review_notes}
                        </p>
                        {latestDecisionDraft.reviewed_at && (
                          <p className="decision-recorded-review__time">
                            Xử lý lúc{" "}
                            {new Date(latestDecisionDraft.reviewed_at).toLocaleString("vi-VN")}
                          </p>
                        )}
                      </section>
                    )}
                </article>

              </>
            )}

            {available.drafts !== false && decisionHistory.length > 0 && (
              <details className="decision-history">
                <summary>
                  Lịch sử hồ sơ hỗ trợ quyết định ({decisionHistory.length})
                </summary>
                <div className="decision-history__list">
                  {decisionHistory.map((draft) => {
                    const historicalBrief = parseDecisionBrief(draft.content);
                    const invalidLegacyTerminal =
                      isTerminalDraftMissingReviewMetadata(draft);
                    return (
                      <article
                        key={draft.id}
                        className="decision-history__item"
                      >
                        <div className="decision-history__meta">
                          <StatusBadge
                            status={
                              invalidLegacyTerminal
                                ? "needs_revision"
                                : draft.status
                            }
                            label={
                              invalidLegacyTerminal
                                ? "Thiếu căn cứ duyệt"
                                : undefined
                            }
                          />
                          {draft.created_at && (
                            <span>
                              {new Date(draft.created_at).toLocaleString("vi-VN")}
                            </span>
                          )}
                        </div>
                        {invalidLegacyTerminal && (
                          <p className="decision-history__notes" role="note">
                            Hồ sơ lịch sử thiếu căn cứ duyệt; không dùng làm căn
                            cứ chính thức
                          </p>
                        )}
                        <p className="decision-history__conclusion">
                          {historicalBrief.conclusion}
                        </p>
                        {draft.review_notes && (
                          <p className="decision-history__notes">
                            Nhận xét: {draft.review_notes}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        </WorkSection>
      )}

      {admin && (
        <WorkSection
          id="operations-innovation"
          index="05"
          title="Theo dõi đổi mới nội bộ"
          description="Các chỉ số thử nghiệm và sáng kiến được tách khỏi hàng việc chính để không làm nhiễu ưu tiên vận hành."
          tone="innovation"
          icon={<Sparkles />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {maturityEnabled && <MetricCard label="Đánh giá trưởng thành số — thử nghiệm" value={available.maturity === false ? "—" : maturity.length} context={available.maturity === false ? "Không tải được dữ liệu" : maturity.length ? "Kết quả nội bộ, không phải xếp hạng chính thức" : "Chưa có tự đánh giá quý"} tone="success" icon={<Target />} />}
            <MetricCard label="Sáng kiến đổi mới" value={available.initiatives === false ? "—" : initiatives.length} context={available.initiatives === false ? "Không tải được dữ liệu" : initiatives.length ? "Có sáng kiến trong danh mục" : "Chưa có sáng kiến được đăng ký"} tone="warning" icon={<ClipboardList />} />
          </div>
        </WorkSection>
      )}
    </div>
  );
}
