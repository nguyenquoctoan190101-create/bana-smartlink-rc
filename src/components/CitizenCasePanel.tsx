import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, CheckCircle2, MapPin, RefreshCw, Send } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { Button, EmptyState, SectionCard } from "./ui";

type Village = { id: string; name: string };
type CaseResult = { tracking_code: string; case: { id?: string; status?: string; created_at?: string }; message: string };

const CATEGORIES = [
  ["road", "Đường giao thông"], ["waste", "Rác thải"], ["water", "Nước / thoát nước"],
  ["power", "Điện chiếu sáng"], ["public_building", "Công trình công cộng"], ["drainage", "Ngập úng"],
  ["safety", "An toàn"], ["other", "Khác"],
] as const;

export default function CitizenCasePanel({ villages, onBack }: { villages: Village[]; onBack: () => void }) {
  const [villageId, setVillageId] = useState(villages[0]?.id ?? "");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("road");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy_m?: number } | null>(null);
  const [media, setMedia] = useState<File[]>([]);
  const [mediaWarning, setMediaWarning] = useState<string | null>(null);
  const [result, setResult] = useState<CaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const captureLocation = () => {
    setError(null);
    if (!navigator.geolocation) { setError("Thiết bị không hỗ trợ định vị. Bạn có thể gửi phản ánh không kèm vị trí."); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: position.coords.accuracy }),
      () => setError("Không lấy được vị trí. Hãy cấp quyền định vị hoặc mô tả địa điểm trong nội dung phản ánh."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!consent) { setError("Bạn cần đồng ý với thông báo quyền riêng tư trước khi gửi."); return; }
    setBusy(true);
    try {
      const data = await apiJson<CaseResult>("/api/cases", { method: "POST", body: JSON.stringify({
        village_id: villageId || null, category, description, priority: "normal", submitter_name: name || null,
        submitter_phone: phone || null, privacy_consent: true, consent_version: "2026-07-18", location_confirmed: Boolean(location),
        location_source: location ? "gps" : null, ...location,
      }) });
      let uploadWarning: string | null = null;
      if (data.case.id && media.length) {
        for (const attachment of media) {
          const form = new FormData();
          form.append("tracking_code", data.tracking_code);
          form.append("file", attachment);
          try {
            await apiJson(`/api/cases/${data.case.id}/media`, { method: "POST", body: form });
          } catch {
            uploadWarning = "Phản ánh đã được tiếp nhận nhưng có tệp chưa tải lên được. Bạn có thể gửi lại phản ánh không kèm tệp hoặc liên hệ cán bộ.";
            break;
          }
        }
      }
      setMediaWarning(uploadWarning);
      setResult(data);
    } catch (cause) { setError(toUserFacingError(cause, "Không thể gửi phản ánh. Vui lòng thử lại.")); }
    finally { setBusy(false); }
  };

  if (result) return <SectionCard className="mx-auto max-w-2xl p-6 text-center md:p-10"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-700" /><h2 className="mt-4 text-2xl font-bold text-slate-900">Đã tiếp nhận phản ánh</h2><p className="mt-2 text-sm text-slate-600">Hãy lưu mã bên dưới. Mã chỉ hiển thị một lần và không chứa thông tin cá nhân.</p>{mediaWarning && <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-900">{mediaWarning}</div>}<div className="mx-auto mt-6 max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-bold text-emerald-800">MÃ TRA CỨU</p><p className="mt-2 break-all font-mono text-xl font-bold tracking-wider text-emerald-950">{result.tracking_code}</p></div><Button className="mt-6" onClick={onBack}>Về cổng dữ liệu</Button></SectionCard>;

  return <SectionCard className="mx-auto max-w-3xl p-5 md:p-8">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-emerald-800">PHẢN ÁNH HIỆN TRƯỜNG</p><h2 className="mt-2 text-2xl font-bold text-slate-900">Báo sự cố để xã xử lý</h2><p className="mt-2 text-sm text-slate-600">Không cần tài khoản. Chỉ gửi thông tin bạn đồng ý chia sẻ; kết quả công khai không hiển thị thông tin cá nhân.</p></div><Button variant="secondary" onClick={onBack}><ArrowLeft />Quay lại</Button></div>
    {error && <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>}
    <form onSubmit={submit} className="mt-6 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Thôn<select className="mt-1.5" value={villageId} onChange={(event) => setVillageId(event.target.value)}>{villages.map((village) => <option key={village.id} value={village.id}>{village.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Loại sự cố<select className="mt-1.5" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label className="block text-sm font-semibold text-slate-700">Mô tả sự cố <span className="text-rose-700">*</span><textarea className="mt-1.5" rows={5} minLength={5} maxLength={4000} required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ví dụ: Đèn đường trước nhà văn hóa không sáng từ tối qua…" /></label>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">Vị trí (tùy chọn)</h3><p className="mt-1 text-xs text-slate-600">Chỉ lấy khi bạn bấm nút; không theo dõi nền.</p></div><Button type="button" variant="secondary" onClick={captureLocation}><MapPin />{location ? "Đã lấy vị trí" : "Lấy vị trí hiện tại"}</Button></div>{location && <p className="mt-3 text-xs text-emerald-800">Độ chính xác khoảng {Math.round(location.accuracy_m ?? 0)} m. Vui lòng kiểm tra trước khi gửi.</p>}</div>
      <label className="block text-sm font-semibold text-slate-700">Ảnh hiện trường (tùy chọn)<input className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { const files = Array.from((event.target as HTMLInputElement).files ?? []); if (files.length > 5 || files.some((file) => file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("Chọn tối đa 5 ảnh JPG, PNG hoặc WebP; mỗi ảnh không quá 8MB."); setMedia([]); return; } setError(null); setMedia(files); }} /><span className="mt-1 block text-xs font-normal text-slate-600">Ảnh chỉ được chia sẻ sau khi cán bộ rà soát. Hãy che biển số, giấy tờ hoặc khuôn mặt nếu các chi tiết đó không cần thiết.</span></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Họ và tên (tùy chọn)<input className="mt-1.5" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label className="text-sm font-semibold text-slate-700">Số điện thoại (tùy chọn)<input className="mt-1.5" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="0901 234 567" /></label></div>
      <label className="flex min-h-12 items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700"><input type="checkbox" className="mt-0.5 h-5! min-h-5! w-5!" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Tôi đồng ý để UBND xã Bà Nà tiếp nhận và xử lý phản ánh theo thông báo quyền riêng tư.</span></label>
      <Button type="submit" disabled={busy || !consent}>{busy ? <RefreshCw className="animate-spin" /> : <Send />}Gửi phản ánh</Button>
    </form>
  </SectionCard>;
}
