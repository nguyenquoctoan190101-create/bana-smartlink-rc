import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, CalendarDays, CheckCircle2, ClipboardList, Clock3, DatabaseZap, FileCheck2, GitCompareArrows, Link2, Loader2, ShieldCheck, Sparkles, Target, UserRoundCheck } from "lucide-react";
import { apiFetch, apiJson, toUserFacingError } from "../lib/apiClient";
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
  title: string;
  priority: string;
  status: string;
  due_date?: string | null;
  owner_name?: string | null;
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
  analysis?: AiDecisionAnalysis;
  village_name?: string;
  quality_status?: string;
  quality_score?: number;
  unresolved_flag_count?: number;
  outlier_count?: number;
  timeliness_status?: string;
  report_source?: string;
  report_version?: number;
  rule_version?: string;
  generator_version?: string;
};
type DecisionDraft = {
  id: string;
  period_id?: string | null;
  status: "pending_review" | "accepted" | "rejected";
  content: string;
  citations?: DraftCitation[];
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
  quality_score: number;
  quality_status: string;
  unresolved_flag_count: number;
  outlier_count: number;
  lineage: { report_source: string; report_version: number };
};
type TrendAlert = {
  village_id: string;
  village_name: string;
  ct_code: string;
  indicator_name: string;
  change_pct: number;
};
type QualityResponse = {
  period?: { id: string; name?: string | null };
  generated_at?: string;
  average_quality_score?: number | null;
  reports?: Quality[];
  rule_version?: string;
};
type LoadResult = {
  key: "quality" | "actions" | "alerts" | "drafts" | "maturity" | "initiatives";
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
    conclusion: content,
    priority: "Chưa phân loại",
    action: "Người có thẩm quyền đọc căn cứ và xác định bước xử lý tiếp theo.",
    basis: "Xem danh sách căn cứ đi kèm bản tóm tắt.",
    limitation:
      "Đây là nội dung hỗ trợ; không thay thế quyết định của người có thẩm quyền.",
  };
  let foundStructuredSection = false;
  for (const line of content.split(/\r?\n/)) {
    const normalizedLine = line.trim();
    const matched = DECISION_SECTION_PREFIXES.find(([, prefix]) =>
      normalizedLine.startsWith(prefix),
    );
    if (!matched) continue;
    foundStructuredSection = true;
    const [key, prefix] = matched;
    result[key] = normalizedLine.slice(prefix.length).trim();
  }
  if (!foundStructuredSection) result.conclusion = content.trim();
  return result;
}

const reportSourceLabels: Record<string, string> = {
  manual: "Nhập thủ công",
  excel: "Tệp Excel",
  photo_ocr: "Ảnh OCR",
  direct_api: "API trực tiếp",
};

const priorityLabels: Record<string, string> = {
  low: "thấp",
  normal: "thông thường",
  high: "cao",
  critical: "khẩn cấp",
};

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
  const [alerts, setAlerts] = useState<TrendAlert[]>([]);
  const [drafts, setDrafts] = useState<DecisionDraft[]>([]);
  const [maturity, setMaturity] = useState<any[]>([]);
  const [initiatives, setInitiatives] = useState<any[]>([]);
  const [actionOutcomes, setActionOutcomes] = useState<Record<string, string>>({});
  const [draftReviewNotes, setDraftReviewNotes] = useState<Record<string, string>>({});
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [available, setAvailable] = useState<Availability>({
    quality: null,
    actions: null,
    alerts: null,
    drafts: null,
    maturity: null,
    initiatives: null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const refresh = async () => {
    setLoading(true);
    setNotice(null);
    const load = async (key: LoadResult["key"], label: string, request: Promise<unknown>): Promise<LoadResult> => {
      try {
        return { key, label, value: await request };
      } catch (error) {
        return { key, label, value: null, error };
      }
    };
    const currentPeriodIndex = periods.findIndex((period) => period.id === periodId);
    const previousPeriod =
      currentPeriodIndex >= 0 ? periods[currentPeriodIndex + 1] : undefined;
    const trendRequest =
      internal && periodId && previousPeriod
        ? apiJson(
            `/reports/trend-alerts?curr_period_id=${encodeURIComponent(periodId)}&prev_period_id=${encodeURIComponent(previousPeriod.id)}`,
          )
        : Promise.resolve([]);
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
      load("alerts", "biến động theo kỳ", trendRequest),
    ];
    if (internal) {
      requests.push(load("drafts", "bản tóm tắt hỗ trợ quyết định", apiJson("/api/operations/ai-drafts")));
    }
    if (admin) {
      requests.push(load("initiatives", "danh mục sáng kiến", apiJson("/api/operations/initiatives")));
      if (maturityEnabled) {
        requests.push(load("maturity", "đánh giá trưởng thành số", apiJson("/api/operations/maturity")));
      }
    }
    const results = await Promise.all(requests);
    setAvailable((current) => {
      const next = { ...current };
      for (const result of results) next[result.key] = !result.error;
      return next;
    });
    for (const result of results) {
      if (result.error) continue;
      if (result.key === "quality") setQuality(result.value as typeof quality);
      if (result.key === "actions") setActions(Array.isArray(result.value) ? (result.value as Action[]) : []);
      if (result.key === "alerts") setAlerts(Array.isArray(result.value) ? (result.value as TrendAlert[]) : []);
      if (result.key === "drafts") setDrafts(Array.isArray(result.value) ? (result.value as DecisionDraft[]) : []);
      if (result.key === "maturity") setMaturity(Array.isArray(result.value) ? result.value : []);
      if (result.key === "initiatives") setInitiatives(Array.isArray(result.value) ? result.value : []);
    }
    const failed = results.filter((result) => result.error).map((result) => result.label);
    if (failed.length) {
      setNotice(`Không tải được ${failed.join(", ")}. Các phần tải thành công vẫn được hiển thị; hãy thử lại sau.`);
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [periodId, role, periods]);

  const openActions = useMemo(() => actions.filter((item) => !["completed", "cancelled"].includes(item.status)), [actions]);
  const overdueActions = useMemo(() => openActions.filter((item) => item.due_date && new Date(item.due_date).getTime() < Date.now()), [openActions]);
  const approvedReports = useMemo(() => (quality?.reports ?? []).filter((item) => !item.workflow_status || ["approved", "locked"].includes(item.workflow_status)), [quality]);
  const visibleQualityReports = useMemo(
    () => (role === "lanh_dao" ? approvedReports : quality?.reports ?? []),
    [approvedReports, quality, role],
  );
  const visibleAverageQuality = useMemo(
    () =>
      visibleQualityReports.length
        ? Math.round(
            (visibleQualityReports.reduce(
              (total, item) => total + item.quality_score,
              0,
            ) /
              visibleQualityReports.length) *
              10,
          ) / 10
        : null,
    [visibleQualityReports],
  );
  const flaggedReports = useMemo(() => visibleQualityReports.filter((item) => item.unresolved_flag_count > 0 || item.outlier_count > 0), [visibleQualityReports]);
  const flaggedApprovedReports = useMemo(() => approvedReports.filter((item) => item.unresolved_flag_count > 0 || item.outlier_count > 0), [approvedReports]);
  const currentPeriodDrafts = useMemo(
    () =>
      drafts
        .filter((item) => !item.period_id || item.period_id === periodId)
        .sort((left, right) => {
          const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
          const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
          return rightTime - leftTime;
        }),
    [drafts, periodId],
  );
  const pendingDrafts = useMemo(() => currentPeriodDrafts.filter((item) => item.status === "pending_review"), [currentPeriodDrafts]);
  const latestDecisionDraft = pendingDrafts[0] ?? currentPeriodDrafts[0];
  const decisionHistory = latestDecisionDraft
    ? currentPeriodDrafts.filter((item) => item.id !== latestDecisionDraft.id)
    : [];
  const executiveMessage = approvedReports.length === 0 ? "Chưa có báo cáo đã phê duyệt để tạo kết luận điều hành; các bản đang xử lý chỉ dùng để theo dõi tiến độ." : overdueActions.length ? `${overdueActions.length} việc đã quá hạn cần xác định trách nhiệm và thời điểm hoàn thành.` : flaggedApprovedReports.length ? `${flaggedApprovedReports.length} báo cáo đã phê duyệt vẫn có điểm cần đối chiếu trước khi dùng làm căn cứ quyết định.` : alerts.length ? `${alerts.length} biến động đáng chú ý cần được đối chiếu với báo cáo và tài liệu nguồn.` : openActions.length ? `${openActions.length} việc đang được theo dõi; chưa ghi nhận việc quá hạn.` : "Chưa ghi nhận việc quá hạn hoặc báo cáo cần rà soát trong phạm vi đang xem.";
  const generatedAt = quality?.generated_at ? new Date(quality.generated_at).toLocaleString("vi-VN") : "Chưa có thời điểm tổng hợp";
  const sourceSummary = Array.from(new Set(approvedReports.map((item) => reportSourceLabels[item.lineage.report_source] ?? "Nguồn khác"))).join(", ") || "Chưa có nguồn đã duyệt";
  const overdueOwners = Array.from(new Set(overdueActions.map((item) => item.owner_name).filter(Boolean))).join(", ") || "Chưa phân công";

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
    if (!periodId) return;
    setDraftBusy("create");
    try {
      await apiJson("/api/operations/ai-drafts", {
        method: "POST",
        body: JSON.stringify({ period_id: periodId, kind: "period_brief" }),
      });
      await refresh();
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
    if (notes.length < 10) {
      setNotice("Không thể lưu quyết định: hãy ghi căn cứ nhận xét ít nhất 10 ký tự.");
      return;
    }
    setDraftBusy(id);
    try {
      await apiJson(`/api/operations/ai-drafts/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      });
      setDraftReviewNotes((current) => ({ ...current, [id]: "" }));
      await refresh();
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
    }
  };

  const latestBriefSections = latestDecisionDraft
    ? parseDecisionBrief(latestDecisionDraft.content)
    : null;
  const latestEvidenceCitations = (latestDecisionDraft?.citations || []).filter(
    (citation) => citation.kind === "quality_snapshot",
  );
  const latestAiCitation = (latestDecisionDraft?.citations || []).find(
    (citation) => citation.kind === "ai_enrichment" && citation.analysis,
  );
  const latestAiStatus = (latestDecisionDraft?.citations || []).find(
    (citation) => citation.kind === "ai_generation",
  );
  const latestAiAnalysis = latestAiCitation?.analysis;
  const recommendedAiOption = latestAiAnalysis?.options.find(
    (option) => option.id === latestAiAnalysis.recommended_option_id,
  );
  const aiEvidenceLabels = new Map(
    (latestDecisionDraft?.citations || [])
      .filter((citation) => citation.id)
      .map((citation) => [
        citation.id as string,
        citation.village_name || citation.label || "Căn cứ tổng hợp",
      ]),
  );
  const evidenceReadiness =
    typeof latestDecisionDraft?.confidence === "number"
      ? Math.round(latestDecisionDraft.confidence * 100)
      : null;
  const canCreateDecisionBrief =
    Boolean(periodId) &&
    approvedReports.length > 0 &&
    pendingDrafts.length === 0 &&
    draftBusy === null;

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
                    <GitCompareArrows aria-hidden="true" /> Biến động đáng chú ý
                  </dt>
                  <dd>{available.alerts === false ? "—" : alerts.length}</dd>
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
          <MetricCard label="Điểm chất lượng" value={available.quality === false || visibleAverageQuality == null ? "—" : `${visibleAverageQuality}%`} context={available.quality === false ? "Không tải được dữ liệu chất lượng" : visibleAverageQuality == null ? "Chưa có dữ liệu" : "Theo bộ quy tắc hiện hành"} tone="info" icon={<DatabaseZap />} />
          <MetricCard label="Báo cáo cần xem" value={available.quality === false ? "—" : flaggedReports.length} context={available.quality === false ? "Không xác định" : `${visibleQualityReports.length} báo cáo trong ${qualityScopeLabel}`} tone={flaggedReports.length ? "warning" : "success"} icon={<ShieldCheck />} />
          {internal ? <MetricCard label="Bản tóm tắt chờ duyệt" value={available.drafts === false ? "—" : pendingDrafts.length} context={available.drafts === false ? "Không tải được bản tóm tắt" : "Có căn cứ và nhận xét người duyệt"} tone="neutral" icon={<BrainCircuit />} /> : <MetricCard label="Báo cáo trong phạm vi" value={available.quality === false ? "—" : (quality?.reports?.length ?? "—")} context="Không cộng dữ liệu ngoài quyền" tone="neutral" icon={<Target />} />}
        </div>
      </WorkSection>

      <WorkSection
        id="operations-tasks"
        index="02"
        title="Hàng việc cần xử lý"
        description="Mỗi thẻ là một việc độc lập, có người phụ trách, mức ưu tiên, thời hạn và hành động tương ứng."
        tone="tasks"
        icon={<ClipboardList />}
      >
        <div className="work-section__list space-y-3">
          {available.actions === false ? (
            <ErrorState title="Chưa tải được danh sách việc" description="Các chỉ số khác vẫn dùng được. Hãy thử tải lại danh sách việc." onRetry={() => void refresh()} />
          ) : (
            <>
              {!actions.length && <EmptyState title="Chưa có việc được phân công" description="Việc mới sẽ xuất hiện tại đây cùng người phụ trách và thời hạn xử lý." />}
              {actions.map((item) => {
                const overdue = item.due_date && new Date(item.due_date).getTime() < Date.now() && !["completed", "cancelled"].includes(item.status);
                return (
                  <ActionCard
                    key={item.id}
                    title={item.title}
                    meta={
                      <span>
                        {item.owner_name ? `Phụ trách: ${item.owner_name} · ` : ""}
                        Ưu tiên {priorityLabels[item.priority] ?? "chưa phân loại"} · Hạn {item.due_date ? new Date(item.due_date).toLocaleDateString("vi-VN") : "chưa đặt"}
                      </span>
                    }
                    status={<StatusBadge status={overdue ? "overdue" : item.status} />}
                  >
                    {item.status === "pending" && role !== "lanh_dao" && (
                      <Button variant="secondary" onClick={() => void updateAction(item.id, "in_progress")}>
                        Nhận việc
                      </Button>
                    )}
                    {item.status === "in_progress" && role !== "lanh_dao" && (
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
                <thead>
                  <tr>
                    <th>Thôn</th>
                    <th>Điểm</th>
                    <th>Trạng thái</th>
                    <th>Cần xem</th>
                    <th>Nguồn và phiên bản</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQualityReports.map((item) => (
                    <tr key={item.report_id}>
                      <td className="font-semibold">{item.village_name}</td>
                      <td>{item.quality_score}%</td>
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
              <Button
                onClick={() => void createDraft()}
                disabled={!canCreateDecisionBrief}
                title={
                  !periodId
                    ? "Hãy chọn kỳ báo cáo"
                    : !approvedReports.length
                      ? "Chưa có báo cáo đã duyệt hoặc khóa"
                      : pendingDrafts.length
                        ? "Đang có một bản chờ duyệt"
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
                  : "Tạo phân tích AI có căn cứ"}
              </Button>
            ) : undefined
          }
        >
          <div className="work-section__list space-y-4">
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
                title="Chưa có bản tóm tắt cho kỳ này"
                description={
                  approvedReports.length
                    ? "Cán bộ xã có thể tạo một bản tóm tắt có căn cứ để người có thẩm quyền xem xét."
                    : "Cần ít nhất một báo cáo đã duyệt hoặc khóa; bản đang xử lý không được dùng làm căn cứ quyết định."
                }
              />
            ) : (
              <>
                <article className="decision-support-card rounded-2xl border bg-white p-5 shadow-sm">
                  <header className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="decision-support-kicker text-4xs font-black uppercase tracking-wider">
                        Bản tóm tắt đang cần xem
                      </p>
                      <h3 className="mt-1 text-base font-black text-slate-950">
                        Căn cứ ra quyết định · {quality?.period?.name || "Kỳ đang chọn"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {latestDecisionDraft.created_at
                          ? `Tạo lúc ${new Date(latestDecisionDraft.created_at).toLocaleString("vi-VN")}`
                          : "Chưa có thời điểm tạo"}
                        {latestAiCitation
                          ? ` · AI có cấu trúc ${latestAiCitation.model || ""}`
                          : latestDecisionDraft.model_provider === "deterministic-evidence-v2"
                            ? " · Tổng hợp bằng luật xác định phiên bản 2"
                            : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={latestDecisionDraft.status} />
                      <span className="decision-support-priority rounded-full border px-2.5 py-1 text-xs font-black">
                        Ưu tiên: {latestBriefSections.priority}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                        Độ sẵn sàng căn cứ {evidenceReadiness == null ? "—" : `${evidenceReadiness}%`}
                      </span>
                    </div>
                  </header>

                  <div className="decision-brief-grid">
                    <section className="decision-brief-card decision-brief-card--conclusion">
                      <p>
                        Kết luận đề xuất
                      </p>
                      <p>
                        {latestBriefSections.conclusion}
                      </p>
                    </section>
                    <section className="decision-brief-card decision-brief-card--action">
                      <p>
                        Việc nên làm tiếp theo
                      </p>
                      <p>
                        {latestBriefSections.action}
                      </p>
                    </section>
                    <section className="decision-brief-card decision-brief-card--basis">
                      <p>
                        Căn cứ định lượng
                      </p>
                      <p>
                        {latestBriefSections.basis}
                      </p>
                    </section>
                    <section className="decision-brief-card decision-brief-card--limitation">
                      <p>
                        Giới hạn sử dụng
                      </p>
                      <p>
                        {latestBriefSections.limitation}
                      </p>
                    </section>
                  </div>

                  {latestAiAnalysis ? (
                    <section className="decision-ai">
                      <header className="decision-ai__header">
                        <div className="decision-ai__meta">
                          <span className="decision-ai__badge">
                            <Sparkles />
                            AI tăng cường · đã kiểm tra dẫn chứng
                          </span>
                          <span className="decision-ai__model">
                            {latestAiCitation?.model || "Mô hình đã cấu hình"} ·{" "}
                            {latestAiCitation?.prompt_version || "phiên bản kiểm soát"}
                          </span>
                        </div>
                        <h4 className="decision-ai__title">
                          Nhận định điều hành
                        </h4>
                        <p className="decision-ai__assessment">
                          {latestAiAnalysis.executive_assessment}
                        </p>
                      </header>

                      <div className="decision-ai__body">
                        <div>
                          <div className="decision-ai__section-heading">
                            <div>
                              <p className="decision-ai__eyebrow">
                                Các phương án để người duyệt cân nhắc
                              </p>
                              {recommendedAiOption && (
                                <p className="decision-ai__hint">
                                  AI nghiêng về phương án {recommendedAiOption.id}; đây không phải quyết định tự động.
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="decision-ai__options">
                            {latestAiAnalysis.options.map((option) => {
                              const recommended =
                                option.id === latestAiAnalysis.recommended_option_id;
                              return (
                                <article
                                  key={option.id}
                                  className={`decision-ai__option ${
                                    recommended ? "decision-ai__option--recommended" : ""
                                  }`}
                                >
                                  <div className="decision-ai__option-header">
                                    <span className="decision-ai__option-id">
                                      {option.id}
                                    </span>
                                    <div className="decision-ai__option-tags">
                                      {recommended && (
                                        <span className="decision-ai__recommended">
                                          Khuyến nghị
                                        </span>
                                      )}
                                      <span className="decision-ai__urgency">
                                        {aiUrgencyLabels[option.urgency]}
                                      </span>
                                    </div>
                                  </div>
                                  <h5 className="decision-ai__option-title">
                                    {option.title}
                                  </h5>
                                  <p className="decision-ai__option-copy">
                                    {option.rationale}
                                  </p>
                                  <div className="decision-ai__tradeoff">
                                    <p className="decision-ai__tradeoff-label">
                                      Đánh đổi cần chấp nhận
                                    </p>
                                    <p>
                                      {option.tradeoff}
                                    </p>
                                  </div>
                                  <div className="decision-ai__evidence">
                                    {option.evidence_ids.map((evidenceId) => (
                                      <span
                                        key={evidenceId}
                                        className="decision-ai__evidence-chip"
                                        title={evidenceId}
                                      >
                                        <Link2 />
                                        {aiEvidenceLabels.get(evidenceId) || "Căn cứ đã kiểm tra"}
                                      </span>
                                    ))}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </div>

                        <div className="decision-ai__review-grid">
                          <section className="decision-ai__risks">
                            <p className="decision-ai__eyebrow">
                              Rủi ro và cách giảm thiểu
                            </p>
                            <div className="decision-ai__risk-list">
                              {latestAiAnalysis.risks.map((risk) => (
                                <article key={`${risk.severity}-${risk.title}`}>
                                  <div className="decision-ai__risk-heading">
                                    <p>
                                      {risk.title}
                                    </p>
                                    <span>
                                      {aiSeverityLabels[risk.severity]}
                                    </span>
                                  </div>
                                  <p className="decision-ai__risk-copy">
                                    {risk.mitigation}
                                  </p>
                                </article>
                              ))}
                            </div>
                          </section>
                          <section className="decision-ai__questions">
                            <p className="decision-ai__eyebrow">
                              Câu hỏi phản biện trước khi duyệt
                            </p>
                            <ul>
                              {latestAiAnalysis.reviewer_questions.map((question) => (
                                <li key={question}>
                                  <span aria-hidden="true">?</span>
                                  <span>{question}</span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        </div>

                        {latestAiAnalysis.assumptions.length > 0 && (
                          <details className="decision-ai__assumptions">
                            <summary>
                              Giả định AI đã dùng ({latestAiAnalysis.assumptions.length})
                            </summary>
                            <ul>
                              {latestAiAnalysis.assumptions.map((assumption) => (
                                <li key={assumption}>{assumption}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </section>
                  ) : (
                    <div className="decision-ai-fallback">
                      <p>
                        Bản an toàn bằng luật xác định
                      </p>
                      <p>
                        {latestAiStatus?.label ||
                          "AI chưa được bật cho bản này; kết luận và căn cứ định lượng vẫn dùng được để rà soát."}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        document
                          .getElementById("operations-evidence")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                    >
                      <FileCheck2 />
                      Đối chiếu dữ liệu
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        document
                          .getElementById("operations-tasks")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                    >
                      <ClipboardList />
                      Mở hàng việc
                    </Button>
                  </div>

                  <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-800">
                      Xem {latestEvidenceCitations.length} căn cứ báo cáo
                    </summary>
                    <div className="grid gap-2 border-t border-slate-200 p-3 md:grid-cols-2">
                      {latestEvidenceCitations.length ? (
                        latestEvidenceCitations.map((citation, index) => (
                          <div
                            key={`${citation.id || "citation"}-${index}`}
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <p className="text-xs font-black text-slate-900">
                              {citation.village_name || citation.label || citation.id || "Căn cứ báo cáo"}
                            </p>
                            <p className="mt-1 text-5xs leading-relaxed text-slate-600">
                              {typeof citation.quality_score === "number"
                                ? `Điểm ${citation.quality_score}% · `
                                : ""}
                              {typeof citation.unresolved_flag_count === "number"
                                ? `${citation.unresolved_flag_count} cảnh báo · `
                                : ""}
                              {reportSourceLabels[citation.report_source || ""] || "Nguồn đã ghi nhận"}
                              {citation.report_version
                                ? ` · phiên bản ${citation.report_version}`
                                : ""}
                            </p>
                            {citation.rule_version && (
                              <p className="mt-1 text-5xs font-mono text-slate-400">
                                Bộ quy tắc {citation.rule_version}
                              </p>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="p-2 text-xs text-slate-500">
                          Bản cũ chưa có căn cứ chi tiết; hãy tạo lại sau khi dữ liệu thay đổi.
                        </p>
                      )}
                    </div>
                  </details>

                  {latestDecisionDraft.status === "pending_review" && admin && (
                    <div className="decision-support-review mt-4 rounded-xl border p-4">
                      <label
                        htmlFor={`draft-review-${latestDecisionDraft.id}`}
                        className="decision-support-review__label block text-sm font-black"
                      >
                        Căn cứ nhận xét của người duyệt
                      </label>
                      <textarea
                        id={`draft-review-${latestDecisionDraft.id}`}
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
                        className="decision-support-review__input mt-2 w-full rounded-xl border bg-white p-3 text-sm text-slate-800 outline-none"
                      />
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                          variant="secondary"
                          disabled={
                            (draftReviewNotes[latestDecisionDraft.id]?.trim().length || 0) < 10 ||
                            draftBusy === latestDecisionDraft.id
                          }
                          onClick={() =>
                            void reviewDraft(latestDecisionDraft.id, "rejected")
                          }
                        >
                          Từ chối và lưu lý do
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
                          {draftBusy === latestDecisionDraft.id && (
                            <Loader2 className="animate-spin" />
                          )}
                          Chấp nhận và lưu căn cứ
                        </Button>
                      </div>
                    </div>
                  )}

                  {latestDecisionDraft.status !== "pending_review" &&
                    latestDecisionDraft.review_notes && (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="font-black text-slate-900">Nhận xét đã lưu</p>
                        <p className="mt-1 leading-relaxed">
                          {latestDecisionDraft.review_notes}
                        </p>
                        {latestDecisionDraft.reviewed_at && (
                          <p className="mt-2 text-xs text-slate-500">
                            Xử lý lúc{" "}
                            {new Date(latestDecisionDraft.reviewed_at).toLocaleString("vi-VN")}
                          </p>
                        )}
                      </div>
                    )}
                </article>

                {decisionHistory.length > 0 && (
                  <details className="rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-800">
                      Lịch sử bản tóm tắt ({decisionHistory.length})
                    </summary>
                    <div className="space-y-2 border-t border-slate-200 p-3">
                      {decisionHistory.map((draft) => {
                        const historicalBrief = parseDecisionBrief(draft.content);
                        return (
                          <article
                            key={draft.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={draft.status} />
                              {draft.created_at && (
                                <span className="text-xs text-slate-500">
                                  {new Date(draft.created_at).toLocaleString("vi-VN")}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-slate-700">
                              {historicalBrief.conclusion}
                            </p>
                            {draft.review_notes && (
                              <p className="mt-2 text-xs text-slate-500">
                                Nhận xét: {draft.review_notes}
                              </p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </details>
                )}
              </>
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
