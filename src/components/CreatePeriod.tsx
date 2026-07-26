import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, Calendar, CheckCircle2, FileSpreadsheet, Loader2, Plus, Trash2, Upload, Users } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { useVillages } from "../lib/useVillages";
import { invalidateReportPeriods } from "../lib/useReportPeriods";
import { normalizeReportPeriodName, reportPeriodNameIssue } from "../lib/reportPeriods";

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
  const allVillageIds = useMemo(() => villages.map((village) => village.id), [villages]);
  const [periodName, setPeriodName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [selectedVillages, setSelectedVillages] = useState<string[]>(allVillageIds);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPeriod | null>(null);
  const [templateUploadFailed, setTemplateUploadFailed] = useState(false);

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

  return (
    <section aria-labelledby="create-period-title" className="mx-auto max-w-3xl space-y-6">
      <header className="rounded-2xl bg-emerald-950 p-6 text-white shadow-md">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-emerald-800 p-3"><Plus aria-hidden="true" className="h-6 w-6" /></span>
          <div>
            <h1 id="create-period-title" className="text-xl font-black">Tạo kỳ báo cáo</h1>
            <p className="mt-1 text-sm text-emerald-100">Kỳ, hạn nộp, phạm vi thôn và tệp mẫu được lưu tập trung trên máy chủ.</p>
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

      <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="period-name" className="block text-sm font-bold text-slate-700">Tên kỳ báo cáo</label>
            <div className="relative mt-2">
              <Calendar aria-hidden="true" className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
              <input id="period-name" required maxLength={120} value={periodName} onChange={(e) => setPeriodName(e.target.value)} className="w-full pl-11" placeholder="Tháng 07/2026" />
            </div>
            <p className="mt-1 text-sm text-slate-500">Nếu đặt tên theo tháng, tháng phải từ 1 đến 12. Tên mô tả khác vẫn được chấp nhận.</p>
          </div>
          <div>
            <label htmlFor="period-deadline" className="block text-sm font-bold text-slate-700">Hạn nộp</label>
            <input id="period-deadline" type="datetime-local" required value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-2 w-full" />
            <p className="mt-1 text-sm text-slate-500">Máy chủ tính đúng hạn/trễ hạn theo múi giờ Việt Nam.</p>
          </div>
        </div>

        <fieldset>
          <legend className="flex items-center gap-2 text-sm font-bold text-slate-700"><Users aria-hidden="true" className="h-5 w-5" />Thôn áp dụng ({selectedVillages.length}/{villages.length})</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedVillages(allVillageIds)} className="min-h-11 rounded-lg bg-emerald-50 px-3 text-sm font-bold text-emerald-800">Chọn tất cả</button>
            <button type="button" onClick={() => setSelectedVillages([])} className="min-h-11 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-700">Bỏ chọn</button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {villages.map((village) => (
              <label key={village.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={selectedVillages.includes(village.id)}
                  onChange={(e) => setSelectedVillages((current) => e.target.checked ? [...current, village.id] : current.filter((id) => id !== village.id))}
                />
                {village.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="period-template" className="block text-sm font-bold text-slate-700">Tệp mẫu XLSX (không bắt buộc)</label>
          {templateFile ? (
            <div className="mt-2 flex min-h-14 items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <span className="flex min-w-0 items-center gap-2 text-sm"><FileSpreadsheet aria-hidden="true" className="h-5 w-5 shrink-0" /><span className="truncate">{templateFile.name}</span></span>
              <button type="button" aria-label="Gỡ tệp mẫu" onClick={() => setTemplateFile(null)} className="min-h-11 min-w-11 rounded-lg text-rose-700"><Trash2 aria-hidden="true" className="mx-auto h-5 w-5" /></button>
            </div>
          ) : (
            <label className="mt-2 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">
              <Upload aria-hidden="true" className="mb-2 h-6 w-6" />Chọn tệp XLSX tối đa 5 MB
              <input id="period-template" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => chooseFile(e.target.files?.[0])} />
            </label>
          )}
          <p className="mt-2 text-sm text-slate-500">Máy chủ kiểm tra cấu trúc XLSX, lưu tệp trong kho riêng tư và ghi SHA-256 để đối chiếu đúng phiên bản.</p>
        </div>

        <button type="submit" disabled={isSubmitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-5 py-3 text-sm font-black text-white disabled:opacity-60">
          {isSubmitting ? <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" /> : <Plus aria-hidden="true" className="h-5 w-5" />}
          {isSubmitting ? "Đang tạo kỳ..." : "Tạo kỳ báo cáo"}
        </button>
      </form>
    </section>
  );
}
