import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, Calendar, Check, CheckCircle2, ClipboardCheck, FileSpreadsheet, Loader2, Plus, Trash2, Upload, Users } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { useVillages } from "../lib/useVillages";
import { invalidateReportPeriods, useReportPeriods } from "../lib/useReportPeriods";
import { normalizeReportPeriodName, reportPeriodNameIssue } from "../lib/reportPeriods";
import ReportPeriodChangeRequests from "./ReportPeriodChangeRequests";

interface CreatedPeriod {
  id: string;
  name: string;
  due_date: string;
  village_ids?: string[];
  notified_count?: number;
  template_name?: string | null;
  template_sha256?: string | null;
}

interface TemplateUploadResult {
  period_id: string;
  template_name: string;
  template_sha256: string;
}

const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function CreatePeriod() {
  const { villages } = useVillages();
  const { periods } = useReportPeriods();
  const allVillageIds = useMemo(() => villages.map((village) => village.id), [villages]);
  const [periodName, setPeriodName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [selectedVillages, setSelectedVillages] = useState<string[]>(allVillageIds);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);
  const [templateUploadFailed, setTemplateUploadFailed] = useState(false);
  const [workspace, setWorkspace] = useState<"create" | "change">("create");

  useEffect(() => {
    if (selectedVillages.length === 0 && allVillageIds.length > 0) {
      setSelectedVillages(allVillageIds);
    }
  }, [allVillageIds, selectedVillages.length]);

  const validateFile = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith(".xlsx") || (file.type && file.type !== XLSX_MIME)) {
      return "Tệp mẫu phải có định dạng XLSX.";
    }
    if (file.size === 0 || file.size > MAX_TEMPLATE_BYTES) {
      return "Tệp mẫu phải lớn hơn 0 byte và không vượt quá 5 MB.";
    }
    return null;
  };

  const chooseFile = (file?: File) => {
    if (!file) return;
    const message = validateFile(file);
    if (message) {
      setTemplateFile(null);
      setError(message);
      return;
    }
    setError(null);
    setTemplateFile(file);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreated(null);
    setTemplateUploadFailed(false);
    const normalizedPeriodName = normalizeReportPeriodName(periodName);
    const periodNameIssue = reportPeriodNameIssue(normalizedPeriodName);
    if (periodNameIssue) return setError(periodNameIssue);
    if (!deadline || Number.isNaN(new Date(deadline).getTime())) return setError("Vui lòng chọn hạn nộp hợp lệ.");
    if (new Date(deadline).getTime() <= Date.now()) return setError("Hạn nộp phải ở tương lai.");
    if (selectedVillages.length === 0) return setError("Vui lòng chọn ít nhất một thôn.");
    if (templateFile) {
      const message = validateFile(templateFile);
      if (message) return setError(message);
    }

    setIsSubmitting(true);
    try {
      const result = await apiJson<CreatedPeriod>("/report-periods", {
        method: "POST",
        body: JSON.stringify({
          name: normalizedPeriodName,
          due_date: new Date(deadline).toISOString(),
          village_ids: selectedVillages,
          template_name: null,
        }),
      });
      // The period exists even when its optional template upload fails. Make
      // it immediately available to every screen using the shared store.
      invalidateReportPeriods();
      let uploadedTemplate: TemplateUploadResult | null = null;
      if (templateFile) {
        const formData = new FormData();
        formData.append("file", templateFile);
        try {
          uploadedTemplate = await apiJson<TemplateUploadResult>(`/report-periods/${result.id}/template`, {
            method: "POST",
            body: formData,
          });
        } catch (cause) {
          setCreated({ ...result, village_ids: selectedVillages, notified_count: selectedVillages.length });
          setTemplateUploadFailed(true);
          setError(`Kỳ báo cáo đã được tạo nhưng chưa tải được biểu mẫu. ${toUserFacingError(cause, "Vui lòng thử tải lại biểu mẫu.")}`);
          return;
        }
      }
      setCreated({ ...result, ...uploadedTemplate, village_ids: selectedVillages, notified_count: selectedVillages.length });
      setPeriodName("");
      setDeadline("");
      setTemplateFile(null);
      setSelectedVillages(allVillageIds);
    } catch (cause) {
      setError(toUserFacingError(cause, "Không thể tạo kỳ báo cáo."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const retryTemplateUpload = async () => {
    if (!created || !templateFile) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", templateFile);
      const uploaded = await apiJson<TemplateUploadResult>(`/report-periods/${created.id}/template`, {
        method: "POST",
        body: formData,
      });
      setCreated((current) => current ? { ...current, ...uploaded } : current);
      setTemplateUploadFailed(false);
      setPeriodName("");
      setDeadline("");
      setTemplateFile(null);
      setSelectedVillages(allVillageIds);
    } catch (cause) {
      setError(toUserFacingError(cause, "Không thể tải lại biểu mẫu."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const setupSteps = [
    { label: "Thông tin kỳ", detail: "Tên và hạn nộp", complete: Boolean(periodName.trim() && deadline) },
    { label: "Phạm vi áp dụng", detail: `${selectedVillages.length}/${villages.length} thôn`, complete: selectedVillages.length > 0 },
    { label: "Biểu mẫu", detail: templateFile ? templateFile.name : "Có thể bổ sung sau", complete: true },
    { label: "Kiểm tra và tạo", detail: "Máy chủ ghi nhận phiên bản", complete: false },
  ];

  return (
    <>
    <nav aria-label="Quản lý kỳ báo cáo" className="mx-auto mb-6 grid max-w-6xl gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2">
      <button type="button" onClick={() => setWorkspace("create")} aria-current={workspace === "create" ? "page" : undefined} className={`min-h-12 rounded-xl px-4 text-sm font-black ${workspace === "create" ? "bg-emerald-800 text-white" : "text-slate-700 hover:bg-emerald-50"}`}>Tạo kỳ và gắn biểu mẫu</button>
      <button type="button" onClick={() => setWorkspace("change")} aria-current={workspace === "change" ? "page" : undefined} className={`min-h-12 rounded-xl px-4 text-sm font-black ${workspace === "change" ? "bg-emerald-800 text-white" : "text-slate-700 hover:bg-emerald-50"}`}>Yêu cầu điều chỉnh hoặc lưu trữ</button>
    </nav>
    {workspace === "create" ? (
    <section aria-labelledby="create-period-title" className="mx-auto max-w-6xl space-y-6">
      <header className="rounded-2xl bg-emerald-950 p-6 text-white shadow-md md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-white/10 p-3 ring-1 ring-white/15">
              <Calendar aria-hidden="true" className="h-7 w-7" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Quản trị báo cáo</p>
              <h1 id="create-period-title" className="mt-1 text-2xl font-black">Tạo kỳ và phân công báo cáo</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-100">
                Thiết lập một lần tên kỳ, hạn nộp, các thôn áp dụng và biểu mẫu dùng chung. Cán bộ chỉ nhìn thấy kỳ thuộc phạm vi được phân công.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">10 thôn áp dụng</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">Múi giờ Việt Nam</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">XLSX có kiểm tra phiên bản</span>
          </div>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0" />{error}
        </div>
      )}
      {created && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span><b>Đã tạo kỳ “{created.name}”.</b> Thông báo nội bộ đã gửi đến {created.notified_count ?? created.village_ids?.length ?? 0} thôn.{created.template_sha256 ? ` Biểu mẫu ${created.template_name || "XLSX"} đã được lưu và kiểm tra SHA-256.` : ""}</span>
        </div>
      )}
      {templateUploadFailed && created && templateFile && (
        <button type="button" onClick={retryTemplateUpload} disabled={isSubmitting} className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900 disabled:opacity-60">
          Tải lại biểu mẫu cho kỳ vừa tạo
        </button>
      )}

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-24">
          <div className="flex items-center gap-2">
            <ClipboardCheck aria-hidden="true" className="h-5 w-5 text-emerald-800" />
            <h2 className="font-bold text-slate-900">4 bước thiết lập</h2>
          </div>
          <ol className="mt-5 space-y-1">
            {setupSteps.map((step, index) => (
              <li key={step.label} className="flex gap-3 rounded-xl p-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                  step.complete ? "bg-emerald-100 text-emerald-800" : index === 0 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"
                }`}>
                  {step.complete ? <Check aria-hidden="true" className="h-4 w-4" /> : index + 1}
                </span>
                <span>
                  <b className="block text-sm text-slate-800">{step.label}</b>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-950">
            <b className="block">Sau khi tạo</b>
            Kỳ xuất hiện ngay trong màn hình lập báo cáo và tiến độ. Hạn nộp được máy chủ dùng để xác định đúng hạn hoặc trễ hạn.
          </div>
        </aside>

        <form onSubmit={submit} className="space-y-5">
          <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <legend className="sr-only">Thông tin kỳ báo cáo</legend>
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-black text-white">1</span>
              <div>
                <h2 className="font-bold text-slate-900">Thông tin kỳ báo cáo</h2>
                <p className="mt-1 text-sm text-slate-600">Dùng tên ngắn, dễ nhận biết và đặt hạn nộp đủ thời gian cho các thôn xử lý.</p>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="period-name" className="block text-sm font-bold text-slate-700">Tên kỳ báo cáo</label>
                <div className="relative mt-2">
                  <Calendar aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                  <input id="period-name" required maxLength={120} value={periodName} onChange={(e) => setPeriodName(e.target.value)} className="w-full pl-11" placeholder="Ví dụ: Tháng 08/2026" />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">Nếu đặt tên theo tháng, tháng phải từ 1 đến 12. Tên mô tả khác vẫn được chấp nhận.</p>
              </div>
              <div>
                <label htmlFor="period-deadline" className="block text-sm font-bold text-slate-700">Hạn nộp</label>
                <input id="period-deadline" type="datetime-local" required value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-2 w-full" />
                <p className="mt-2 text-xs leading-relaxed text-slate-500">Máy chủ tính đúng hạn hoặc trễ hạn theo múi giờ Việt Nam.</p>
              </div>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <legend className="sr-only">Phạm vi thôn áp dụng</legend>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-black text-white">2</span>
                <div>
                  <h2 className="font-bold text-slate-900">Chọn thôn áp dụng</h2>
                  <p className="mt-1 text-sm text-slate-600">Đã chọn {selectedVillages.length}/{villages.length} thôn cho kỳ này.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setSelectedVillages(allVillageIds)} className="min-h-11 rounded-lg bg-emerald-50 px-3 text-sm font-bold text-emerald-800">Chọn tất cả</button>
                <button type="button" onClick={() => setSelectedVillages([])} className="min-h-11 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-700">Bỏ chọn</button>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {villages.map((village) => {
                const checked = selectedVillages.includes(village.id);
                return (
                  <label key={village.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-semibold transition-colors ${
                    checked ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200"
                  }`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setSelectedVillages((current) => e.target.checked ? [...current, village.id] : current.filter((id) => id !== village.id))}
                    />
                    <Users aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                    {village.name}
                    {checked && <Check aria-hidden="true" className="ml-auto h-4 w-4 text-emerald-700" />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6" aria-labelledby="period-template-title">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-black text-white">3</span>
              <div>
                <h2 id="period-template-title" className="font-bold text-slate-900">Biểu mẫu dùng chung</h2>
                <p className="mt-1 text-sm text-slate-600">Không bắt buộc. Có thể tạo kỳ trước và tải biểu mẫu XLSX lên sau.</p>
              </div>
            </div>
            {templateFile ? (
              <div className="flex min-h-16 items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <span className="flex min-w-0 items-center gap-3 text-sm font-semibold text-emerald-950"><FileSpreadsheet aria-hidden="true" className="h-6 w-6 shrink-0" /><span className="truncate">{templateFile.name}</span></span>
                <button type="button" aria-label="Gỡ tệp mẫu" onClick={() => setTemplateFile(null)} className="min-h-11 min-w-11 rounded-lg text-rose-700 hover:bg-rose-50"><Trash2 aria-hidden="true" className="mx-auto h-5 w-5" /></button>
              </div>
            ) : (
              <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-600 transition-colors hover:border-emerald-400 hover:bg-emerald-50">
                <Upload aria-hidden="true" className="mb-3 h-7 w-7 text-emerald-800" />
                <b className="text-slate-800">Chọn tệp XLSX tối đa 5 MB</b>
                <span className="mt-1 text-xs">Máy chủ kiểm tra cấu trúc và ghi mã đối chiếu SHA-256.</span>
                <input id="period-template" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => chooseFile(e.target.files?.[0])} />
              </label>
            )}
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm md:p-6" aria-labelledby="period-review-title">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-black text-white">4</span>
                <div>
                  <h2 id="period-review-title" className="font-bold text-emerald-950">Kiểm tra trước khi tạo</h2>
                  <p className="mt-1 text-sm leading-relaxed text-emerald-900">
                    {periodName.trim() || "Kỳ chưa đặt tên"} · {selectedVillages.length} thôn · {templateFile ? `có biểu mẫu ${templateFile.name}` : "chưa gắn biểu mẫu"}.
                  </p>
                </div>
              </div>
              <button type="submit" disabled={isSubmitting} className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-800 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-900 disabled:opacity-60">
                {isSubmitting ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Plus aria-hidden="true" className="h-5 w-5" />}
                {isSubmitting ? "Đang tạo kỳ..." : "Tạo kỳ báo cáo"}
              </button>
            </div>
          </section>
        </form>
      </div>
    </section>
    ) : (
      <ReportPeriodChangeRequests role="admin_xa" periods={periods} />
    )}
    </>
  );
}
