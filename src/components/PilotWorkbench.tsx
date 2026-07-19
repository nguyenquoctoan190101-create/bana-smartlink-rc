import { useEffect, useState } from "react";
import { Compass, Loader2, Radio, RefreshCw, ShieldAlert } from "lucide-react";
import type { UserRole } from "../types";
import { apiJson } from "../lib/apiClient";
import { Button, EmptyState, ErrorState, PageHeader, SectionCard } from "./ui";
import PilotObservatory from "./PilotObservatory";

type Props = { role: UserRole };
type PilotStatus = { iot_enabled: boolean; tourism_enabled: boolean };
type Device = { id: string; name: string; device_type: string; unit: string; latitude?: number | null; longitude?: number | null };
type Place = { id: string; name: string; category: string; summary: string; opening_hours?: string | null; accessibility_notes?: string | null; latitude?: number | null; longitude?: number | null };

const deviceTypes = { water_level: "Mực nước", rain_gauge: "Lượng mưa", vibration: "Rung chấn", noise: "Tiếng ồn", tilt: "Độ nghiêng", other: "Khác" };
const placeCategories = { nature: "Thiên nhiên", heritage: "Di sản", homestay: "Lưu trú", food: "Ẩm thực", craft: "Nghề truyền thống", service: "Dịch vụ" };

export default function PilotWorkbench({ role }: Props) {
  const admin = role === "admin_xa";
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceType, setDeviceType] = useState("water_level");
  const [deviceUnit, setDeviceUnit] = useState("m");
  const [placeName, setPlaceName] = useState("");
  const [placeCategory, setPlaceCategory] = useState("nature");
  const [placeSummary, setPlaceSummary] = useState("");
  const [placeHours, setPlaceHours] = useState("");

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const next = await apiJson<PilotStatus>("/api/pilots/status");
      setStatus(next);
      const [nextDevices, nextPlaces] = await Promise.all([
        next.iot_enabled ? apiJson<Device[]>("/api/pilots/sensors/devices") : Promise.resolve([]),
        next.tourism_enabled ? apiJson<Place[]>("/api/pilots/tourism/places") : Promise.resolve([]),
      ]);
      setDevices(nextDevices); setPlaces(nextPlaces);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được trạng thái pilot."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const createDevice = async () => {
    if (!deviceName.trim() || !deviceUnit.trim()) return;
    await apiJson<Device>("/api/pilots/sensors/devices", { method: "POST", body: JSON.stringify({ name: deviceName.trim(), device_type: deviceType, unit: deviceUnit.trim() }) });
    setDeviceName(""); setNotice("Đã tạo thiết bị pilot. Cần hiệu chuẩn và người phụ trách trước khi dùng cảnh báo."); await refresh();
  };
  const createPlace = async () => {
    if (!placeName.trim() || !placeSummary.trim()) return;
    await apiJson<Place>("/api/pilots/tourism/places", { method: "POST", body: JSON.stringify({ name: placeName.trim(), category: placeCategory, summary: placeSummary.trim(), opening_hours: placeHours.trim() || null }) });
    setPlaceName(""); setPlaceSummary(""); setPlaceHours(""); setNotice("Đã lưu điểm du lịch ở trạng thái chờ duyệt nội bộ."); await refresh();
  };

  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-800" />Đang tải pilot…</div>;
  if (error) return <ErrorState description={error} onRetry={() => void refresh()} />;
  const iotEnabled = Boolean(status?.iot_enabled);
  const tourismEnabled = Boolean(status?.tourism_enabled);
  return <div className="space-y-5">
    <PageHeader eyebrow="PILOT CÓ KIỂM SOÁT" title="IoT và du lịch cộng đồng" description="Khu vực thử nghiệm nội bộ. Dữ liệu cảm biến và nội dung du lịch phải được kiểm chứng, hiệu chuẩn và duyệt trước khi công bố." actions={<Button variant="secondary" onClick={() => void refresh()}><RefreshCw />Làm mới</Button>} />
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{notice}</div>}
    <div className="grid gap-4 md:grid-cols-2"><div className={`rounded-xl border p-4 ${iotEnabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-2 font-bold"><Radio className="h-5 w-5" />Pilot IoT {iotEnabled ? "đang bật" : "đang tắt"}</div><p className="mt-2 text-sm text-slate-600">Chỉ hiển thị ngưỡng và bất thường sau khi có thiết bị, dữ liệu hiệu chuẩn và người chịu trách nhiệm.</p></div><div className={`rounded-xl border p-4 ${tourismEnabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-2 font-bold"><Compass className="h-5 w-5" />Pilot du lịch {tourismEnabled ? "đang bật" : "đang tắt"}</div><p className="mt-2 text-sm text-slate-600">Danh mục phải có nguồn, bản quyền và phê duyệt; chưa có Digital Twin hay dự báo luồng khách.</p></div></div>
    {!iotEnabled && !tourismEnabled ? <SectionCard><EmptyState title="Pilot đang tắt ở môi trường này" description="Bật cờ pilot trên staging sau khi có phê duyệt, thiết bị và dữ liệu thử nghiệm." /></SectionCard> : <>
      <div className="grid gap-5 lg:grid-cols-2"><SectionCard><h2 className="text-lg font-bold">Thiết bị cảm biến</h2>{devices.length ? <ul className="knowledge-list mt-3">{devices.map((device) => <li className="knowledge-item" key={device.id}><strong>{device.name}</strong><span>{deviceTypes[device.device_type as keyof typeof deviceTypes] || device.device_type} · đơn vị {device.unit}</span></li>)}</ul> : <EmptyState title="Chưa có thiết bị" description="Tạo thiết bị sau khi xác nhận vị trí và kế hoạch hiệu chuẩn." />}{admin && iotEnabled && <div className="knowledge-form mt-3"><input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Tên thiết bị" /><select value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>{Object.entries(deviceTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><div className="flex gap-2"><input className="min-w-0 flex-1" value={deviceUnit} onChange={(e) => setDeviceUnit(e.target.value)} placeholder="Đơn vị (m, mm, dB…)" /><Button onClick={() => void createDevice()} disabled={!deviceName.trim()}>Tạo thiết bị</Button></div></div>}</SectionCard><SectionCard><h2 className="text-lg font-bold">Điểm du lịch đã duyệt</h2>{places.length ? <ul className="knowledge-list mt-3">{places.map((place) => <li className="knowledge-item" key={place.id}><strong>{place.name}</strong><span>{placeCategories[place.category as keyof typeof placeCategories] || place.category} · {place.summary}</span><span>{place.opening_hours || "Chưa cập nhật giờ mở cửa"}</span></li>)}</ul> : <EmptyState title="Chưa có điểm du lịch" description="Chỉ thêm nội dung có nguồn và bản quyền rõ ràng." />}{admin && tourismEnabled && <div className="knowledge-form mt-3"><input value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="Tên điểm đến" /><select value={placeCategory} onChange={(e) => setPlaceCategory(e.target.value)}>{Object.entries(placeCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><textarea value={placeSummary} onChange={(e) => setPlaceSummary(e.target.value)} placeholder="Mô tả có nguồn, không tự bịa giá/giờ mở cửa" /><div className="flex gap-2"><input className="min-w-0 flex-1" value={placeHours} onChange={(e) => setPlaceHours(e.target.value)} placeholder="Giờ mở cửa" /><Button onClick={() => void createPlace()} disabled={!placeName.trim() || !placeSummary.trim()}>Thêm điểm</Button></div></div>}</SectionCard></div>
      <PilotObservatory enabled={iotEnabled} />
    </>}
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600"><ShieldAlert className="mr-2 inline h-4 w-4 text-amber-600" />Không dùng pilot này để phát cảnh báo thiên tai chính thức, dự báo AI hoặc theo dõi cá nhân. Mọi cảnh báo cần nguồn, phạm vi và thời hạn hiệu lực.</div>
  </div>;
}
