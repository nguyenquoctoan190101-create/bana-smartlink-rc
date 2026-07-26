import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Archive,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FilePenLine,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { invalidateReportPeriods } from "../lib/useReportPeriods";
import { useVillages } from "../lib/useVillages";
import type { ReportPeriod } from "../types";

type Snapshot = {
  name: string;
  due_date: string;
  village_ids: string[];
};

type ChangeDecision = {
  id: string;
  decision: "approved" | "rejected";
  reason: string;
  decided_at: string;
  decider_name: string;
};

type ChangeRequest = {
  id: string;
  period_id: string;
  period_name: string;
  request_kind: "update" | "delete";
  reason: string;
  before_snapshot: Snapshot;
  proposed_snapshot: Snapshot | null;
  requested_at: string;
  requester_name: string;
  status: "pending" | "approved" | "rejected";
  decision: ChangeDecision | null;
};

type Props = {
  role: "admin_xa" | "lanh_dao";
  periods: ReportPeriod[];
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(parsed);
};

const toDateTimeLocal = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const sameIds = (left: string[], right: string[]) =>
  [...left].sort().join("|") === [...right].sort().join("|");

export default function ReportPeriodChangeRequests({ role, periods }: Props) {
  const { villages } = useVillages();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState(periods[0]?.id || "");
  const [requestKind, setRequestKind] = useState<"update" | "delete">("update");
  const [proposedName, setProposedName] = useState("");
  const [proposedDueDate, setProposedDueDate] = useState("");
  const [proposedVillageIds, setProposedVillageIds] = useState<string[]>([]);
  const [requestReason, setRequestReason] = useState("");
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const villageNames = useMemo(
    () => new Map(villages.map((village) => [village.id, village.name])),
    [villages],
  );
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiJson<ChangeRequest[]>("/report-periods/change-requests");
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (cause) {
      setError(toUserFacingError(cause, "Không tải được lịch sử thay đổi kỳ báo cáo."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!periods.some((period) => period.id === selectedPeriodId)) {
      setSelectedPeriodId(periods[0]?.id || "");
    }
  }, [periods, selectedPeriodId]);

  useEffect(() => {
    if (!selectedPeriod) return;
    setProposedName(selectedPeriod.name);
    setProposedDueDate(toDateTimeLocal(selectedPeriod.due_date));
    setProposedVillageIds(selectedPeriod.village_ids || []);
  }, [selectedPeriod?.id]);

  const villageList = (ids: string[]) => {
    if (!ids.length) return "Chưa có thôn";
    return ids.map((id) => villageNames.get(id) || "Thôn không còn hoạt động").join(", ");
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPeriod) return setError("Vui lòng chọn kỳ báo cáo.");
    const reason = requestReason.trim();
    if (reason.length < 10) return setError("Lý do phải có ít nhất 10 ký tự.");
    const body: Record<string, unknown> = { request_kind: requestKind, reason };
    if (requestKind === "update") {
      const normalizedName = proposedName.trim();
      const changedName = normalizedName !== selectedPeriod.name;
      const changedDue = proposedDueDate !== toDateTimeLocal(selectedPeriod.due_date);
      const originalVillages = selectedPeriod.village_ids || [];
      const changedVillages = !sameIds(proposedVillageIds, originalVillages);
      if (!changedName && !changedDue && !changedVillages) {
        return setError("Chưa có thông tin nào thay đổi so với kỳ hiện tại.");
      }
      if (!normalizedName) return setError("Tên kỳ báo cáo không được để trống.");
      if (!proposedDueDate) return setError("Hạn nộp không được để trống.");
      if (!proposedVillageIds.length) return setError("Phải giữ ít nhất một thôn áp dụng.");
      if (changedName) body.proposed_name = normalizedName;
      if (changedDue) body.proposed_due_date = new Date(proposedDueDate).toISOString();
      if (changedVillages) body.proposed_village_ids = proposedVillageIds;
    }
    setSubmitting("request");
    setError(null);
    setMessage(null);
    try {
      await apiJson(`/report-periods/${selectedPeriod.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setRequestReason("");
      setMessage("Đã gửi yêu cầu. Kỳ báo cáo chỉ thay đổi sau khi lãnh đạo xã phê duyệt.");
      await refresh();
    } catch (cause) {
      setError(toUserFacingError(cause, "Không gửi được yêu cầu thay đổi kỳ báo cáo."));
    } finally {
      setSubmitting(null);
    }
  };

  const decide = async (request: ChangeRequest, decision: "approved" | "rejected") => {
    const reason = (decisionReasons[request.id] || "").trim();
    if (reason.length < 5) return setError("Lãnh đạo cần ghi lý do quyết định, tối thiểu 5 ký tự.");
    setSubmitting(request.id);
    setError(null);
    setMessage(null);
    try {
      await apiJson(`/report-periods/change-requests/${request.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      });
      setDecisionReasons((current) => ({ ...current, [request.id]: "" }));
      invalidateReportPeriods();
      setMessage(decision === "approved" ? "Đã phê duyệt và áp dụng thay đổi." : "Đã từ chối yêu cầu.");
      await refresh();
    } catch (cause) {
      setError(toUserFacingError(cause, "Không lưu được quyết định."));
    } finally {
      setSubmitting(null);
    }
  };

  const pending = requests.filter((request) => request.status === "pending");
  const history = requests.filter((request) => request.status !== "pending");

  const renderSnapshot = (title: string, snapshot: Snapshot) => (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div><dt className="inline font-bold text-slate-700">Tên kỳ: </dt><dd className="inline text-slate-900">{snapshot.name}</dd></div>
        <div><dt className="inline font-bold text-slate-700">Hạn nộp: </dt><dd className="inline text-slate-900">{formatDateTime(snapshot.due_date)}</dd></div>
        <div><dt className="font-bold text-slate-700">Phạm vi ({snapshot.village_ids.length} thôn)</dt><dd className="mt-1 leading-relaxed text-slate-600">{villageList(snapshot.village_ids)}</dd></div>
      </dl>
    </div>
  );

  const renderRequest = (request: ChangeRequest, leaderActions = false) => (
    <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
              request.request_kind === "delete" ? "bg-rose-100 text-rose-800" : "bg-blue-100 text-blue-800"
            }`}>{request.request_kind === "delete" ? "Yêu cầu lưu trữ kỳ" : "Yêu cầu điều chỉnh"}</span>
            {request.status === "pending" && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">Chờ lãnh đạo duyệt</span>}
            {request.status === "approved" && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">Đã phê duyệt</span>}
            {request.status === "rejected" && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-700">Đã từ chối</span>}
          </div>
          <h3 className="mt-3 text-lg font-black text-slate-900">{request.period_name}</h3>
          <p className="mt-1 text-sm text-slate-500">{request.requester_name} gửi lúc {formatDateTime(request.requested_at)}</p>
        </div>
        <span className="text-xs font-mono text-slate-400">Mã {request.id.slice(0, 8)}</span>
      </div>
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <b>Lý do đề nghị:</b> {request.reason}
      </div>
      <div className={`mt-4 grid gap-4 ${request.proposed_snapshot ? "lg:grid-cols-2" : ""}`}>
        {renderSnapshot("Thông tin đang lưu", request.before_snapshot)}
        {request.proposed_snapshot ? (
          renderSnapshot("Thông tin đề nghị thay đổi", request.proposed_snapshot)
        ) : (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-900">
            <b>Ảnh hưởng khi phê duyệt:</b> kỳ này sẽ được ẩn khỏi các màn hình đang hoạt động. Báo cáo đã có và toàn bộ lịch sử vẫn được giữ nguyên, không xóa vật lý.
          </div>
        )}
      </div>
      {leaderActions && request.status === "pending" && (
        <div className="mt-5 border-t border-slate-200 pt-5">
          <label htmlFor={`decision-${request.id}`} className="block text-sm font-bold text-slate-700">Lý do quyết định <span className="text-rose-700">*</span></label>
          <textarea id={`decision-${request.id}`} rows={3} maxLength={1000} value={decisionReasons[request.id] || ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [request.id]: event.target.value }))} className="mt-2 w-full" placeholder="Nêu căn cứ đồng ý hoặc lý do từ chối..." />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => void decide(request, "rejected")} disabled={submitting === request.id} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-black text-rose-800 disabled:opacity-60"><XCircle className="h-4 w-4" />Từ chối</button>
            <button type="button" onClick={() => void decide(request, "approved")} disabled={submitting === request.id} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 text-sm font-black text-white disabled:opacity-60">{submitting === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Phê duyệt</button>
          </div>
        </div>
      )}
      {request.decision && (
        <div className={`mt-4 rounded-xl p-4 text-sm ${request.decision.decision === "approved" ? "bg-emerald-50 text-emerald-950" : "bg-slate-100 text-slate-800"}`}>
          <b>{request.decision.decider_name}</b> {request.decision.decision === "approved" ? "đã phê duyệt" : "đã từ chối"} lúc {formatDateTime(request.decision.decided_at)}. <b>Lý do:</b> {request.decision.reason}
        </div>
      )}
    </article>
  );

  return (
    <section className="mx-auto max-w-6xl space-y-6" aria-labelledby="period-change-title">
      <header className="rounded-2xl bg-emerald-950 p-6 text-white shadow-md md:p-8">
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-white/10 p-3 ring-1 ring-white/15">{role === "admin_xa" ? <FilePenLine className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}</span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Kiểm soát thay đổi</p>
            <h1 id="period-change-title" className="mt-1 text-2xl font-black">{role === "admin_xa" ? "Yêu cầu điều chỉnh hoặc lưu trữ kỳ báo cáo" : "Phê duyệt thay đổi kỳ báo cáo"}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-100">Mọi yêu cầu và quyết định được lưu vĩnh viễn, không cho phép sửa hoặc xóa. Việc lưu trữ kỳ không làm mất báo cáo đã nộp.</p>
          </div>
        </div>
      </header>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
      {message && <div role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5 shrink-0" />{message}</div>}

      {role === "admin_xa" && (
        <form onSubmit={submitRequest} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <label htmlFor="change-period" className="block text-sm font-bold text-slate-700">Kỳ báo cáo</label>
              <select id="change-period" value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)} className="mt-2 w-full" required>
                {periods.map((period) => <option key={period.id} value={period.id}>{period.display_name || period.name}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="text-sm font-bold text-slate-700">Loại yêu cầu</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRequestKind("update")} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${requestKind === "update" ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-600"}`}><FilePenLine className="mr-2 inline h-4 w-4" />Điều chỉnh</button>
                <button type="button" onClick={() => setRequestKind("delete")} className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${requestKind === "delete" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-slate-200 text-slate-600"}`}><Archive className="mr-2 inline h-4 w-4" />Lưu trữ kỳ</button>
              </div>
            </fieldset>
          </div>

          {requestKind === "update" && selectedPeriod && (
            <div className="mt-5 grid gap-5 border-t border-slate-200 pt-5 md:grid-cols-2">
              <div><label htmlFor="proposed-period-name" className="block text-sm font-bold text-slate-700">Tên kỳ đề nghị</label><input id="proposed-period-name" value={proposedName} onChange={(event) => setProposedName(event.target.value)} maxLength={120} className="mt-2 w-full" /></div>
              <div><label htmlFor="proposed-period-due" className="block text-sm font-bold text-slate-700">Hạn nộp đề nghị</label><input id="proposed-period-due" type="datetime-local" value={proposedDueDate} onChange={(event) => setProposedDueDate(event.target.value)} className="mt-2 w-full" /></div>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-bold text-slate-700">Phạm vi thôn đề nghị ({proposedVillageIds.length}/{villages.length})</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{villages.map((village) => <label key={village.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={proposedVillageIds.includes(village.id)} onChange={(event) => setProposedVillageIds((current) => event.target.checked ? [...current, village.id] : current.filter((id) => id !== village.id))} />{village.name}</label>)}</div>
              </fieldset>
            </div>
          )}

          {requestKind === "delete" && <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-900"><b>Không xóa vật lý:</b> sau khi lãnh đạo phê duyệt, kỳ được ẩn khỏi danh sách hoạt động; báo cáo, căn cứ và lịch sử vẫn được giữ nguyên.</div>}

          <div className="mt-5 border-t border-slate-200 pt-5">
            <label htmlFor="period-change-reason" className="block text-sm font-bold text-slate-700">Lý do đề nghị <span className="text-rose-700">*</span></label>
            <textarea id="period-change-reason" rows={3} maxLength={1000} required value={requestReason} onChange={(event) => setRequestReason(event.target.value)} className="mt-2 w-full" placeholder="Nêu sai sót, căn cứ và ảnh hưởng cần xử lý..." />
            <div className="mt-4 flex justify-end"><button type="submit" disabled={submitting === "request" || !periods.length} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-800 px-5 text-sm font-black text-white disabled:opacity-60">{submitting === "request" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}Gửi lãnh đạo phê duyệt</button></div>
          </div>
        </form>
      )}

      {role === "lanh_dao" && (
        <section aria-labelledby="pending-change-title" className="space-y-4">
          <div className="flex items-center justify-between"><h2 id="pending-change-title" className="text-xl font-black text-slate-900">Yêu cầu chờ phê duyệt</h2><span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-black text-amber-900">{pending.length} yêu cầu</span></div>
          {loading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Đang tải yêu cầu…</p> : pending.length ? pending.map((request) => renderRequest(request, true)) : <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" /><p className="mt-3 font-bold text-slate-800">Không có yêu cầu chờ duyệt</p><p className="mt-1 text-sm">Các kỳ báo cáo đang giữ nguyên trạng thái hiện tại.</p></div>}
        </section>
      )}

      <section aria-labelledby="change-history-title" className="space-y-4">
        <div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-emerald-800" /><h2 id="change-history-title" className="text-xl font-black text-slate-900">Lịch sử quyết định bất biến</h2></div>
        {loading && role === "admin_xa" ? <p role="status" className="text-sm text-slate-600">Đang tải lịch sử…</p> : history.length ? history.map((request) => renderRequest(request)) : <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">Chưa có yêu cầu nào đã được quyết định.</div>}
        {role === "admin_xa" && pending.length > 0 && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><b>Đang chờ:</b> {pending.length} yêu cầu chưa được lãnh đạo quyết định.</div>}
      </section>
    </section>
  );
}
