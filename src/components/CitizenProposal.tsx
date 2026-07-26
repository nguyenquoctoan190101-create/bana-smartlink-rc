import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, Copy, MessageSquare, RefreshCw } from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import { useVillages } from "../lib/useVillages";
import { PUBLIC_INDICATOR_CODES } from "../types";
import { Button, PageHeader, SectionCard } from "./ui";

interface CitizenProposalProps {
  reports: any[];
  onProposalSubmitted: () => void;
  onOpenFieldReport?: () => void;
}
type Step = 1 | 2 | 3 | 4;

const indicatorNames: Record<string, string> = {
  CT01: "Tổng số hộ dân", CT02: "Tổng số nhân khẩu", CT09: "Gia đình văn hóa",
  CT12: "Thành viên Tổ công nghệ số cộng đồng", CT13: "Người được hướng dẫn sử dụng dịch vụ công trực tuyến trong kỳ",
};
const indicatorUnits: Record<string, string> = {
  CT01: "hộ", CT02: "người", CT09: "hộ", CT12: "người", CT13: "người",
};

export default function CitizenProposal({ reports, onProposalSubmitted, onOpenFieldReport }: CitizenProposalProps) {
  const { villages } = useVillages();
  const [step, setStep] = useState<Step>(1);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [selectedVillage, setSelectedVillage] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [selectedIndicator, setSelectedIndicator] = useState("CT01");
  const [suggestedValue, setSuggestedValue] = useState("");
  const [explanation, setExplanation] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [trackingCode, setTrackingCode] = useState<string | null>(null);
  const [trackingCodeCopied, setTrackingCodeCopied] = useState(false);

  const villageReports = useMemo(() => reports.filter((report) => report.village_id === selectedVillage), [reports, selectedVillage]);
  const villageName = villages.find((item) => item.id === selectedVillage)?.name || "Chưa chọn thôn";
  const selectedReport = villageReports.find((item) => item.id === selectedReportId);
  const reportName = selectedReport?.report_period || "Chưa chọn kỳ";
  const publishedValue = selectedReport?.[selectedIndicator] ?? selectedReport?.values?.[selectedIndicator];
  const hasPublishedValue = typeof publishedValue === "number" && Number.isFinite(publishedValue);

  useEffect(() => { if (!selectedVillage && villages.length) setSelectedVillage(villages[0].id); }, [selectedVillage, villages]);
  useEffect(() => { setSelectedReportId(villageReports[0]?.id || ""); }, [selectedVillage, reports]);

  const moveTo = (next: Step) => {
    setError(null);
    if (next === 2 && (!selectedReportId || suggestedValue === "" || !explanation.trim())) {
      setError(!selectedReportId ? "Thôn này chưa có bản công bố để đối chiếu." : "Vui lòng nhập giá trị đề xuất và lý do điều chỉnh.");
      return;
    }
    if (next === 3 && !phone.trim()) {
      setError("Vui lòng nhập số điện thoại để cán bộ liên hệ đối chiếu.");
      return;
    }
    setStep(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!privacyConsent) { setError("Bạn cần đồng ý với thông báo quyền riêng tư trước khi gửi."); return; }
    setError(null); setIsSending(true);
    try {
      const response = await apiFetch("/auth/citizen/pending-updates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: selectedReportId, village_id: selectedVillage, ct_code: selectedIndicator, proposed_value: Number(suggestedValue), proposed_by_phone: phone.trim(), submitter_name: submitterName.trim() || undefined, explanation, privacy_consent: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.detail || "Không thể gửi đề nghị đối chiếu.");
      setTrackingCode(typeof result.tracking_code === "string" ? result.tracking_code : null);
      setStep(4); onProposalSubmitted();
    } catch (caught) { setError(toUserFacingError(caught, "Không thể gửi đề nghị đối chiếu.")); }
    finally { setIsSending(false); }
  };

  const reset = () => {
    setStep(1); setSuggestedValue(""); setExplanation(""); setPhone(""); setSubmitterName(""); setPrivacyConsent(false); setTrackingCode(null); setTrackingCodeCopied(false); setError(null);
  };

  const copyTrackingCode = async () => {
    if (!trackingCode) return;
    try {
      await navigator.clipboard.writeText(trackingCode);
      setTrackingCodeCopied(true);
    } catch {
      setError("Không thể sao chép tự động. Vui lòng chọn và sao chép mã tra cứu.");
    }
  };

  return <div className="mx-auto max-w-4xl">
    <PageHeader eyebrow="Đối chiếu dữ liệu công khai" title="Gửi đề nghị đối chiếu số liệu" description="Biểu mẫu tiếp nhận đề nghị kiểm tra 5 chỉ tiêu công khai. Số liệu chỉ được thay đổi sau khi cán bộ có thẩm quyền đối chiếu nguồn." />
    <SectionCard className="overflow-hidden">
      <div className="border-b border-slate-200 p-5 md:p-7">
        <ol className="grid grid-cols-3 gap-2" aria-label="Tiến trình gửi đề nghị đối chiếu số liệu">
          {["Số liệu", "Liên hệ", "Xác nhận"].map((label, index) => { const number = index + 1; const active = step >= number; return <li key={label} aria-current={step === number ? "step" : undefined} className={`flex items-center gap-2 border-t-2 pt-3 text-xs font-semibold ${active ? "border-emerald-700 text-emerald-900" : "border-slate-200 text-slate-400"}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${active ? "bg-emerald-800 text-white" : "bg-slate-100"}`}>{step > number ? <Check className="h-3.5 w-3.5" /> : number}</span>{label}</li>; })}
        </ol>
      </div>
      <form onSubmit={submit} className="p-5 md:p-7">
        {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div>}
        {step === 1 && <div className="space-y-5"><div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p className="font-bold">Phạm vi tiếp nhận</p><p className="mt-1 leading-relaxed">Biểu mẫu áp dụng cho CT01, CT02, CT09, CT12 và CT13. Vấn đề về đường, điện, nước, rác thải hoặc an toàn được tiếp nhận tại mục phản ánh hiện trường.</p>{onOpenFieldReport && <Button type="button" variant="secondary" className="mt-3" onClick={onOpenFieldReport}>Phản ánh hiện trường<ArrowRight /></Button>}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Thôn<select className="mt-1.5" value={selectedVillage} onChange={(event) => setSelectedVillage(event.target.value)}>{villages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Kỳ công bố<select className="mt-1.5" value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} disabled={!villageReports.length}>{!villageReports.length && <option value="">Chưa có bản công bố</option>}{villageReports.map((report) => <option key={report.id} value={report.id}>{report.report_period}</option>)}</select></label></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(12rem,.8fr)_minmax(12rem,.8fr)]"><label className="text-sm font-semibold text-slate-700">Chỉ tiêu công khai cần đối chiếu<select className="mt-1.5" value={selectedIndicator} onChange={(event) => setSelectedIndicator(event.target.value)}>{PUBLIC_INDICATOR_CODES.map((code) => <option key={code} value={code}>{code} · {indicatorNames[code]}</option>)}</select></label><div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3" aria-live="polite"><p className="text-xs font-semibold text-slate-500">Giá trị đang công bố</p><p className="mt-1 text-lg font-bold text-slate-900">{hasPublishedValue ? `${Number(publishedValue).toLocaleString("vi-VN")} ${indicatorUnits[selectedIndicator]}` : "Chưa có dữ liệu"}</p><p className="mt-1 text-xs text-slate-500">{reportName}</p></div><label className="text-sm font-semibold text-slate-700">Giá trị đề xuất <span className="font-normal text-slate-500">({indicatorUnits[selectedIndicator]})</span><input className="mt-1.5" type="number" min={0} value={suggestedValue} onChange={(event) => setSuggestedValue(event.target.value)} required /></label></div><label className="block text-sm font-semibold text-slate-700">Lý do cần đối chiếu<textarea className="mt-1.5" rows={4} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Nêu nguồn thông tin và nội dung cần kiểm tra…" required /></label><div className="flex justify-end"><Button type="button" onClick={() => moveTo(2)}>Tiếp tục<ArrowRight /></Button></div></div>}
        {step === 2 && (
          <div className="space-y-6">
            <section aria-labelledby="citizen-proposal-contact-heading" className="rounded-xl border border-slate-200 bg-slate-25 p-4 sm:p-5">
              <h3 id="citizen-proposal-contact-heading" className="text-sm font-bold text-slate-900">Thông tin người gửi</h3>
              <p className="mt-1 text-xs text-slate-500">Chỉ trường số điện thoại là bắt buộc. Họ và tên có thể để trống.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label htmlFor="citizen-proposal-name" className="block text-sm font-semibold text-slate-700">Họ và tên <span className="font-normal text-slate-500">(không bắt buộc)</span><input id="citizen-proposal-name" className="mt-1.5 w-full" type="text" value={submitterName} onChange={(event) => setSubmitterName(event.target.value)} autoComplete="name" placeholder="Ví dụ: Nguyễn Văn A" /></label>
                <label htmlFor="citizen-proposal-phone" className="block text-sm font-semibold text-slate-700">Số điện thoại <span aria-hidden="true" className="text-rose-700">*</span><input id="citizen-proposal-phone" className="mt-1.5 w-full" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ví dụ: 0901 234 567" required /></label>
              </div>
            </section>
            <div className="flex justify-between gap-3"><Button type="button" variant="secondary" onClick={() => moveTo(1)}><ArrowLeft />Quay lại</Button><Button type="button" onClick={() => moveTo(3)}>Tiếp tục<ArrowRight /></Button></div>
          </div>
        )}
        {step === 3 && <div className="space-y-5"><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold text-slate-900">Xác nhận nội dung</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Phạm vi</dt><dd className="font-semibold text-slate-900">{villageName} · {reportName}</dd></div><div><dt className="text-slate-500">Chỉ tiêu</dt><dd className="font-semibold text-slate-900">{selectedIndicator} · {indicatorNames[selectedIndicator]}</dd></div><div><dt className="text-slate-500">Giá trị đang công bố</dt><dd className="font-semibold text-slate-900">{hasPublishedValue ? `${Number(publishedValue).toLocaleString("vi-VN")} ${indicatorUnits[selectedIndicator]}` : "Chưa có dữ liệu"}</dd></div><div><dt className="text-slate-500">Giá trị đề xuất</dt><dd className="font-semibold text-slate-900">{Number(suggestedValue).toLocaleString("vi-VN")} {indicatorUnits[selectedIndicator]}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">Lý do</dt><dd className="font-semibold text-slate-900">{explanation}</dd></div></dl></div><label className="flex min-h-14 items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700"><input className="mt-0.5 h-5! min-h-5! w-5!" type="checkbox" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} required /><span>Tôi đồng ý gửi số điện thoại, thông tin tùy chọn đã nhập và nội dung đề nghị để UBND xã Bà Nà xử lý theo thông báo quyền riêng tư.</span></label><div className="flex justify-between gap-3"><Button type="button" variant="secondary" onClick={() => moveTo(2)}><ArrowLeft />Quay lại</Button><Button type="submit" disabled={isSending || !privacyConsent}>{isSending ? <RefreshCw className="animate-spin" /> : <ClipboardCheck />}Gửi đề nghị đối chiếu</Button></div></div>}
        {step === 4 && <div className="py-6 text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-800"><CheckCircle2 className="h-8 w-8" /></span><h3 className="mt-5 text-xl font-bold text-slate-900">Đề nghị đối chiếu đã được ghi nhận</h3><p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">Lưu mã bên dưới để theo dõi trạng thái. Thông tin cá nhân không được lặp lại trên màn hình xác nhận.</p>{trackingCode && <div className="mx-auto mt-5 max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-800">MÃ TRA CỨU</p><p className="mt-1 select-all font-mono text-xl font-bold tracking-wider text-emerald-950">{trackingCode}</p><Button type="button" variant="secondary" className="mt-3" onClick={() => void copyTrackingCode()}><Copy />{trackingCodeCopied ? "Đã sao chép" : "Sao chép mã"}</Button></div>}<Button type="button" className="mt-6" onClick={reset}><MessageSquare />Gửi đề nghị khác</Button></div>}
      </form>
    </SectionCard>
  </div>;
}
