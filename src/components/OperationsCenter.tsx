import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, ClipboardList, DatabaseZap, Loader2, ShieldCheck, Sparkles, Target } from "lucide-react";
import { apiFetch, apiJson } from "../lib/apiClient";
import type { UserRole } from "../types";
import { ActionCard, Button, DataScope, EmptyState, ErrorState, MetricCard, PageHeader, SectionCard, StatusBadge } from "./ui";

type Props = { periodId: string; role: UserRole };
type Action = { id: string; title: string; priority: string; status: string; due_date?: string | null; owner_name?: string | null };
type Quality = { report_id: string; village_name: string; quality_score: number; quality_status: string; unresolved_flag_count: number; outlier_count: number; lineage: { report_source: string; report_version: number } };
type LoadResult = { key: "quality" | "actions" | "drafts" | "maturity" | "initiatives"; label: string; value: unknown; error?: unknown };
type Availability = Record<LoadResult["key"], boolean | null>;

const reportSourceLabels: Record<string, string> = {
  manual: "Nhập thủ công",
  excel: "Tệp Excel",
  photo_ocr: "Ảnh OCR",
  direct_api: "API trực tiếp",
};

const roleCopy: Record<string, { eyebrow: string; title: string; description: string }> = {
  admin_xa: { eyebrow: "Điều hành toàn xã", title: "Hộp việc điều hành", description: "Ưu tiên việc quá hạn và cảnh báo dữ liệu trước khi xem số liệu tổng hợp." },
  lanh_dao: { eyebrow: "Không gian lãnh đạo", title: "Brief quyết định", description: "Tiến độ, chất lượng dữ liệu và điểm cần can thiệp trong một phạm vi rõ ràng." },
  can_bo_thon: { eyebrow: "Không gian cán bộ thôn", title: "Việc của tôi", description: "Hoàn thành việc được giao, rà soát báo cáo và theo dõi trạng thái nộp." },
  to_cnscd: { eyebrow: "Tổ công nghệ số cộng đồng", title: "Việc hỗ trợ của tôi", description: "Theo dõi việc hỗ trợ thôn và các báo cáo cần đối chiếu dữ liệu." },
};

export default function OperationsCenter({ periodId, role }: Props) {
  const [quality, setQuality] = useState<{ average_quality_score?: number | null; reports?: Quality[]; rule_version?: string } | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [maturity, setMaturity] = useState<any[]>([]);
  const [initiatives, setInitiatives] = useState<any[]>([]);
  const [available, setAvailable] = useState<Availability>({ quality: null, actions: null, drafts: null, maturity: null, initiatives: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const internal = role === "admin_xa" || role === "lanh_dao";
  const admin = role === "admin_xa";
  const copy = roleCopy[role] ?? roleCopy.can_bo_thon;

  const refresh = async () => {
    setLoading(true); setNotice(null);
    const load = async (key: LoadResult["key"], label: string, request: Promise<unknown>): Promise<LoadResult> => {
      try { return { key, label, value: await request }; }
      catch (error) { return { key, label, value: null, error }; }
    };
    const requests: Promise<LoadResult>[] = [
      load("quality", "chất lượng dữ liệu", periodId ? apiJson(`/api/operations/quality?period_id=${encodeURIComponent(periodId)}`) : Promise.resolve(null)),
      load("actions", "danh sách việc", apiJson("/api/operations/actions")),
    ];
    if (internal) {
      requests.push(
        load("drafts", "brief chờ duyệt", apiJson("/api/operations/ai-drafts")),
        load("maturity", "đánh giá trưởng thành số", apiJson("/api/operations/maturity")),
        load("initiatives", "danh mục sáng kiến", apiJson("/api/operations/initiatives")),
      );
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
      if (result.key === "actions") setActions(Array.isArray(result.value) ? result.value as Action[] : []);
      if (result.key === "drafts") setDrafts(Array.isArray(result.value) ? result.value : []);
      if (result.key === "maturity") setMaturity(Array.isArray(result.value) ? result.value : []);
      if (result.key === "initiatives") setInitiatives(Array.isArray(result.value) ? result.value : []);
    }
    const failed = results.filter((result) => result.error).map((result) => result.label);
    if (failed.length) {
      setNotice(`Không tải được ${failed.join(", ")}. Các phần tải thành công vẫn được hiển thị; hãy thử lại sau.`);
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [periodId, role]);

  const openActions = useMemo(() => actions.filter((item) => !["completed", "cancelled"].includes(item.status)), [actions]);
  const overdueActions = useMemo(() => openActions.filter((item) => item.due_date && new Date(item.due_date).getTime() < Date.now()), [openActions]);
  const flaggedReports = useMemo(() => (quality?.reports ?? []).filter((item) => item.unresolved_flag_count > 0 || item.outlier_count > 0), [quality]);

  const updateAction = async (id: string, status: "in_progress" | "completed") => {
    const response = await apiFetch(`/api/operations/actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) setNotice("Không thể cập nhật việc. Chỉ chủ việc hoặc quản trị xã được phép."); else void refresh();
  };
  const createDraft = async () => {
    if (!periodId) return;
    const response = await apiFetch("/api/operations/ai-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period_id: periodId, kind: "period_brief" }) });
    setNotice(response.ok ? "Đã tạo bản nháp có dẫn chứng. Bản nháp đang chờ người có thẩm quyền xem xét." : "Không thể tạo bản nháp.");
    if (response.ok) void refresh();
  };
  const reviewDraft = async (id: string, decision: "accepted" | "rejected") => {
    const response = await apiFetch(`/api/operations/ai-drafts/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    if (!response.ok) setNotice("Không thể duyệt bản nháp."); else void refresh();
  };

  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-800" />Đang tải không gian điều hành…</div>;

  return <div className="space-y-6">
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={<Button variant="secondary" onClick={() => void refresh()}>Làm mới</Button>} />
    {notice && (notice.startsWith("Không") ? <ErrorState description={notice} onRetry={() => void refresh()} /> : <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">{notice}</div>)}

    <DataScope period={periodId ? "Kỳ đang chọn" : "Chưa có kỳ"} scope={role === "can_bo_thon" ? "Thôn được phân công" : role === "to_cnscd" ? "Thôn được hỗ trợ" : "Toàn xã"} quality={quality?.rule_version ? `Bộ quy tắc ${quality.rule_version}` : "Chưa có dữ liệu đánh giá"} />

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Việc đang mở" value={available.actions === false ? "—" : openActions.length} context={available.actions === false ? "Không tải được danh sách việc" : overdueActions.length ? `${overdueActions.length} việc đã quá hạn` : "Không có việc quá hạn"} tone={overdueActions.length ? "danger" : "success"} icon={<ClipboardList />} />
      <MetricCard label="Điểm chất lượng" value={available.quality === false || quality?.average_quality_score == null ? "—" : `${quality.average_quality_score}%`} context={available.quality === false ? "Không tải được dữ liệu chất lượng" : quality?.average_quality_score == null ? "Chưa có dữ liệu" : "Theo bộ quy tắc hiện hành"} tone="info" icon={<DatabaseZap />} />
      <MetricCard label="Báo cáo cần xem" value={available.quality === false ? "—" : flaggedReports.length} context={available.quality === false ? "Không xác định" : `${quality?.reports?.length ?? 0} báo cáo trong phạm vi`} tone={flaggedReports.length ? "warning" : "success"} icon={<ShieldCheck />} />
      {internal ? <MetricCard label="Brief chờ duyệt" value={available.drafts === false ? "—" : drafts.filter((item) => item.status === "pending_review").length} context={available.drafts === false ? "Không tải được brief" : "AI chỉ tạo bản nháp"} tone="neutral" icon={<BrainCircuit />} /> : <MetricCard label="Báo cáo trong phạm vi" value={available.quality === false ? "—" : quality?.reports?.length ?? "—"} context="Không cộng dữ liệu ngoài quyền" tone="neutral" icon={<Target />} />}
    </div>

    <SectionCard className="p-5 md:p-6">
      <div><h2 className="text-lg font-bold text-slate-900">Việc cần xử lý</h2><p className="mt-1 text-sm text-slate-600">Sắp xếp theo hạn và mức ưu tiên; trạng thái được cập nhật ngay trên hệ thống.</p></div>
      <div className="mt-5 space-y-3">
        {available.actions === false ? <ErrorState title="Chưa tải được danh sách việc" description="Các chỉ số khác vẫn dùng được. Hãy thử tải lại danh sách việc." onRetry={() => void refresh()} /> : <>{!actions.length && <EmptyState title="Chưa có việc được phân công" description="Việc mới sẽ xuất hiện tại đây cùng người phụ trách và thời hạn xử lý." />}{actions.map((item) => { const overdue = item.due_date && new Date(item.due_date).getTime() < Date.now() && !["completed", "cancelled"].includes(item.status); return <ActionCard key={item.id} title={item.title} meta={<span>{item.owner_name ? `Phụ trách: ${item.owner_name} · ` : ""}Ưu tiên {item.priority} · Hạn {item.due_date ? new Date(item.due_date).toLocaleDateString("vi-VN") : "chưa đặt"}</span>} status={<StatusBadge status={overdue ? "overdue" : item.status} />}>{item.status === "pending" && role !== "lanh_dao" && <Button variant="secondary" onClick={() => void updateAction(item.id, "in_progress")}>Nhận việc</Button>}{item.status === "in_progress" && role !== "lanh_dao" && <Button onClick={() => void updateAction(item.id, "completed")}><CheckCircle2 />Hoàn tất</Button>}</ActionCard>; })}</>}
      </div>
    </SectionCard>

    {internal && <SectionCard className="p-5 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><BrainCircuit className="h-5 w-5 text-indigo-700" />Brief điều hành chờ duyệt</h2><p className="mt-1 text-sm text-slate-600">Không dùng PII/CT14; bản nháp không tự giao việc, duyệt hoặc công bố.</p></div>{admin && <Button onClick={() => void createDraft()} disabled={!periodId}><Sparkles />Tạo bản nháp</Button>}</div>
      <div className="mt-5 space-y-3">{available.drafts === false ? <ErrorState title="Chưa tải được brief" description="Phần việc và chất lượng dữ liệu không bị ảnh hưởng." onRetry={() => void refresh()} /> : <>{!drafts.length && <EmptyState title="Chưa có brief" description="Quản trị xã có thể tạo bản nháp sau khi kỳ báo cáo có dữ liệu đủ chất lượng." />}{drafts.slice(0, 5).map((draft) => <article key={draft.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-sm leading-relaxed text-slate-800">{draft.content}</p><div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={draft.status} /><span className="text-xs text-slate-500">Độ tin cậy {draft.confidence ?? "—"}</span>{admin && draft.status === "pending_review" && <div className="ml-auto flex gap-2"><Button onClick={() => void reviewDraft(draft.id, "accepted")}>Chấp nhận</Button><Button variant="secondary" onClick={() => void reviewDraft(draft.id, "rejected")}>Từ chối</Button></div>}</div></article>)}</>}</div>
    </SectionCard>}

    <SectionCard className="overflow-hidden">
      <div className="border-b border-slate-200 p-5 md:p-6"><h2 className="text-lg font-bold text-slate-900">Chất lượng dữ liệu theo báo cáo</h2><p className="mt-1 text-sm text-slate-600">Mỗi dòng có nguồn nhập, phiên bản và số cảnh báo cần người có trách nhiệm xem lại.</p></div>
      <div className="overflow-x-auto">{available.quality === false ? <div className="p-5"><ErrorState title="Chưa tải được chất lượng dữ liệu" description="Không hiển thị số 0 thay cho dữ liệu chưa tải được." onRetry={() => void refresh()} /></div> : <><table className="min-w-[760px]"><thead><tr><th>Thôn</th><th>Điểm</th><th>Trạng thái</th><th>Cần xem</th><th>Nguồn và phiên bản</th></tr></thead><tbody>{(quality?.reports ?? []).map((item) => <tr key={item.report_id}><td className="font-semibold">{item.village_name}</td><td>{item.quality_score}%</td><td><StatusBadge status={item.quality_status} /></td><td>{item.unresolved_flag_count} lỗi · {item.outlier_count} bất thường</td><td>{reportSourceLabels[item.lineage.report_source] ?? "Nguồn khác"} · phiên bản {item.lineage.report_version}</td></tr>)}</tbody></table>{!quality?.reports?.length && <EmptyState title="Chưa có báo cáo để đánh giá" description="Dữ liệu chất lượng sẽ xuất hiện sau khi kỳ báo cáo có bản ghi trong phạm vi quyền." />}</>}</div>
    </SectionCard>

    {internal && <div className="grid gap-4 md:grid-cols-2"><MetricCard label="Đánh giá trưởng thành số" value={available.maturity === false ? "—" : maturity.length} context={available.maturity === false ? "Không tải được dữ liệu" : maturity.length ? "Có dữ liệu để tiếp tục theo dõi" : "Chưa có đánh giá quý"} tone="success" icon={<Target />} /><MetricCard label="Sáng kiến đổi mới" value={available.initiatives === false ? "—" : initiatives.length} context={available.initiatives === false ? "Không tải được dữ liệu" : initiatives.length ? "Có sáng kiến trong danh mục" : "Chưa có sáng kiến được đăng ký"} tone="warning" icon={<ClipboardList />} /></div>}
  </div>;
}
