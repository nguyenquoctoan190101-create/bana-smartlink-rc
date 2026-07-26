import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowRight, Award, Check, CheckCircle2, ClipboardCheck, Copy, FileSearch, FileText, Home, Lock, MapPin, MessageSquare, Navigation, Phone, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { apiFetch, apiJson, toUserFacingError } from "../lib/apiClient";
import {
  formatPublicLookupMessage,
  getPublicCaseCategoryLabel,
  getPublicLookupEndpoint,
  getPublicStatusLabel,
} from "../lib/publicLookup";
import { loadVillages } from "../lib/useVillages";
import { BaNaBrandScenery, Button, DataScope, EmptyState, ErrorState, FilterBar, MetricCard, SectionCard, StatusBadge, TopographicPattern } from "./ui";
import CitizenCasePanel from "./CitizenCasePanel";

const PUBLIC_INDICATORS = [
  { code: "CT01", name: "Tổng số hộ dân", unit: "hộ", icon: Home, tone: "info" as const },
  { code: "CT02", name: "Tổng số nhân khẩu", unit: "người", icon: Users, tone: "success" as const },
  { code: "CT09", name: "Gia đình văn hóa", unit: "hộ", icon: Award, tone: "warning" as const },
  { code: "CT12", name: "Thành viên Tổ công nghệ số cộng đồng", unit: "người", icon: Users, tone: "success" as const },
  { code: "CT13", name: "Người được hướng dẫn sử dụng dịch vụ công trực tuyến trong kỳ", unit: "người", icon: FileText, tone: "info" as const },
];

type PublicMode = "data" | "lookup" | "proposal" | "case";
type ProposalStep = 1 | 2 | 3 | 4;

type EvacuationPoint = {
  id: string;
  village_id: string;
  name: string;
  latitude: number;
  longitude: number;
  capacity_households: number;
  is_verified: boolean;
};

export function formatPublicIndicatorValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("vi-VN") : "—";
}

export function extractPublishedPeriods(reports: unknown[]): string[] {
  const periodNames = reports
    .map((report) => {
      if (!report || typeof report !== "object") return null;
      const value = (report as { report_period?: unknown }).report_period;
      return typeof value === "string" && value.trim() ? value.trim() : null;
    })
    .filter((value): value is string => value !== null);

  return [...new Set(periodNames)];
}

/**
 * The catalogue may contain a newly-created village that does not have a
 * published report yet.  Start citizens on the first village that actually
 * has public data instead of presenting an empty dashboard by default.
 */
export function getDefaultPublicVillageId(villages: unknown[], reports: unknown[]): string {
  const publishedVillageIds = new Set(
    reports
      .map((report) => report && typeof report === "object" ? (report as { village_id?: unknown }).village_id : null)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const firstPublishedVillage = villages.find((village) => {
    if (!village || typeof village !== "object") return false;
    const id = (village as { id?: unknown }).id;
    return typeof id === "string" && publishedVillageIds.has(id);
  }) as { id?: unknown } | undefined;

  if (typeof firstPublishedVillage?.id === "string") return firstPublishedVillage.id;
  const firstVillage = villages.find((village) => village && typeof village === "object") as { id?: unknown } | undefined;
  return typeof firstVillage?.id === "string" ? firstVillage.id : "";
}

export function getPublicReportTimestamp(report: unknown): string {
  if (!report || typeof report !== "object") return "";
  const candidate = report as { updated_at?: unknown; published_at?: unknown };
  if (typeof candidate.published_at === "string" && candidate.published_at.trim()) {
    return candidate.published_at;
  }
  return typeof candidate.updated_at === "string" ? candidate.updated_at : "";
}

interface PublicVillagePageProps {
  onGoToLogin?: () => void;
}

export default function PublicVillagePage({ onGoToLogin }: PublicVillagePageProps) {
  const [villages, setVillages] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [evacuationPoints, setEvacuationPoints] = useState<EvacuationPoint[]>([]);
  const [selectedVillageId, setSelectedVillageId] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("all_time");
  const [mode, setMode] = useState<PublicMode>("data");
  const [proposalStep, setProposalStep] = useState<ProposalStep>(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const [phone, setPhone] = useState("");
  const [submitterName, setSubmitterName] = useState("");
  const [selectedIndicator, setSelectedIndicator] = useState(PUBLIC_INDICATORS[0].code);
  const [suggestedValue, setSuggestedValue] = useState("");
  const [explanation, setExplanation] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [trackingCode, setTrackingCode] = useState<string | null>(null);
  const [trackingCodeCopied, setTrackingCodeCopied] = useState(false);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState<{ status: string; message?: string; case?: { category?: string } } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchData() {
      setIsLoading(true);
      setDataError(null);
      try {
        const [villageData, reportData, evacuationData] = await Promise.all([
          loadVillages(),
          apiJson<unknown[]>("/reports/public"),
          apiJson<unknown[]>("/api/pilots/evacuation-points").catch(() => []),
        ]);
        if (!active) return;
        const safeVillages = Array.isArray(villageData) ? villageData : [];
        const safeReports = Array.isArray(reportData) ? reportData : [];
        const safeEvacuationPoints = Array.isArray(evacuationData) ? evacuationData.filter((point): point is EvacuationPoint => Boolean(point && typeof point === "object" && typeof (point as EvacuationPoint).id === "string" && typeof (point as EvacuationPoint).name === "string" && typeof (point as EvacuationPoint).latitude === "number" && typeof (point as EvacuationPoint).longitude === "number")) : [];
        setVillages(safeVillages);
        setReports(safeReports);
        setEvacuationPoints(safeEvacuationPoints);
        setPeriods(extractPublishedPeriods(safeReports));
        setSelectedVillageId((current) => current || getDefaultPublicVillageId(safeVillages, safeReports));
      } catch {
        if (active) setDataError("Dịch vụ dữ liệu công khai chưa sẵn sàng. Bạn vẫn có thể xem cấu trúc cổng và thử lại sau.");
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void fetchData();
    return () => { active = false; };
  }, [reloadKey]);

  const relevantReports = useMemo(() => {
    const scoped = reports.filter((report) => report?.village_id === selectedVillageId);
    if (selectedPeriod !== "all_time") return scoped.filter((report) => report?.report_period === selectedPeriod);
    return [...scoped].sort((a, b) => getPublicReportTimestamp(b).localeCompare(getPublicReportTimestamp(a))).slice(0, 1);
  }, [reports, selectedPeriod, selectedVillageId]);

  const selectedReport = relevantReports[0];
  const values = selectedReport?.values ?? {};
  const villageName = villages.find((item) => item?.id === selectedVillageId)?.name || "Chưa chọn thôn";
  const periodLabel = selectedPeriod === "all_time" ? selectedReport?.report_period || "Bản công bố mới nhất" : selectedPeriod;
  const reportTimestamp = getPublicReportTimestamp(selectedReport);
  const updatedLabel = reportTimestamp ? new Date(reportTimestamp).toLocaleDateString("vi-VN") : "Chưa có bản công bố";
  const selectedIndicatorMeta = PUBLIC_INDICATORS.find((indicator) => indicator.code === selectedIndicator) ?? PUBLIC_INDICATORS[0];
  const selectedPublishedValue = values[selectedIndicator];
  const hasSelectedPublishedValue = typeof selectedPublishedValue === "number" && Number.isFinite(selectedPublishedValue);

  const goToProposalStep = (step: ProposalStep) => {
    setFormError(null);
    if (step === 2 && (!selectedReport || suggestedValue === "" || !explanation.trim())) {
      setFormError(!selectedReport ? "Thôn hoặc kỳ này chưa có báo cáo công khai để kiến nghị." : "Vui lòng nhập giá trị đề xuất và lý do điều chỉnh.");
      return;
    }
    if (step === 3 && !phone.trim()) {
      setFormError("Vui lòng nhập số điện thoại để cán bộ liên hệ đối chiếu.");
      return;
    }
    setProposalStep(step);
  };

  const handleSubmitProposal = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedReport || !privacyConsent) {
      setFormError(!selectedReport ? "Không tìm thấy bản công bố phù hợp để đối chiếu." : "Bạn cần đồng ý với thông báo quyền riêng tư trước khi gửi.");
      return;
    }
    setFormError(null);
    setIsSending(true);
    try {
      const response = await apiFetch("/auth/citizen/pending-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: selectedReport.id,
          village_id: selectedVillageId,
          ct_code: selectedIndicator,
          proposed_value: Number(suggestedValue),
          proposed_by_phone: phone.trim(),
          submitter_name: submitterName.trim() || undefined,
          explanation,
          privacy_consent: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.detail || "Không thể gửi đề nghị đối chiếu.");
      setTrackingCode(typeof result.tracking_code === "string" ? result.tracking_code : null);
      setProposalStep(4);
    } catch (error) {
      setFormError(toUserFacingError(error, "Không thể gửi đề nghị đối chiếu. Vui lòng thử lại."));
    } finally {
      setIsSending(false);
    }
  };

  const lookupSubmission = async (event: FormEvent) => {
    event.preventDefault();
    setLookupResult(null);
    const code = lookupCode.trim().toUpperCase();
    try {
      const endpoint = getPublicLookupEndpoint(code);
      if (!endpoint) {
        throw new Error("Mã tra cứu phải có 16 ký tự (kiến nghị) hoặc 32 ký tự (phản ánh).");
      }
      const result = await apiJson<{ status: string; message?: string; case?: { category?: string } }>(endpoint);
      // Keep only the non-sensitive category for the public result. Never retain
      // the API's case object wholesale because it may contain internal notes or PII.
      const safeCase = result.case?.category ? { category: result.case.category } : undefined;
      setLookupResult({ status: result.status, message: result.message, case: safeCase });
    } catch {
      setLookupResult({ status: "not_found", message: "Không tìm thấy mã tra cứu hoặc mã không hợp lệ." });
    }
  };

  const resetProposal = () => {
    setProposalStep(1);
    setSuggestedValue("");
    setExplanation("");
    setPhone("");
    setSubmitterName("");
    setPrivacyConsent(false);
    setTrackingCode(null);
    setTrackingCodeCopied(false);
    setMode("data");
  };

  const copyTrackingCode = async () => {
    if (!trackingCode) return;
    try {
      await navigator.clipboard.writeText(trackingCode);
      setTrackingCodeCopied(true);
    } catch {
      setFormError("Không thể sao chép tự động. Vui lòng chọn và sao chép mã tra cứu.");
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6" id="public-village-portal">
      <section className={`public-hero relative overflow-hidden rounded-xl bg-[#0f5a48] px-5 py-8 text-white md:px-10 md:py-12 ${mode === "data" ? "" : "public-hero--compact"}`}>
        <picture className="public-hero-photo" aria-hidden="true">
          <source
            type="image/webp"
            srcSet="/images/ba-na/ba-na-hero-golden-bridge-960.webp 960w, /images/ba-na/ba-na-hero-golden-bridge-1920.webp 1920w"
            sizes="(max-width: 767px) 100vw, (max-width: 1536px) 94vw, 1480px"
          />
          <img
            src="/images/ba-na/ba-na-hero-golden-bridge.jpg"
            width="1920"
            height="1078"
            alt=""
            decoding="async"
            fetchPriority="high"
          />
        </picture>
        <TopographicPattern className="text-white" />
        <BaNaBrandScenery className="public-brand-scenery" />
        <div className="public-hero-copy relative z-10 max-w-3xl">
          <p className="public-hero-kicker">CỔNG THÔNG TIN CÔNG KHAI</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.035em] md:text-5xl">Thông tin công khai xã Bà Nà</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-emerald-50 md:text-base">Tra cứu số liệu đã công bố theo thôn và kỳ báo cáo. Gửi yêu cầu đối chiếu khi phát hiện thông tin chưa chính xác.</p>
        </div>
        <div className="public-hero-nav relative z-10 mt-7 flex flex-wrap gap-3" aria-label="Điều hướng cổng công khai">
          <Button aria-pressed={mode === "data"} variant={mode === "data" ? "secondary" : "quiet"} className={mode !== "data" ? "border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" : ""} onClick={() => setMode("data")}><FileText />Số liệu công khai</Button>
          <Button aria-pressed={mode === "proposal"} variant={mode === "proposal" ? "secondary" : "quiet"} className={mode !== "proposal" ? "border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" : ""} onClick={() => { setMode("proposal"); setProposalStep(1); }}><MessageSquare />Đề nghị đối chiếu số liệu</Button>
          <Button aria-pressed={mode === "case"} variant={mode === "case" ? "secondary" : "quiet"} className={mode !== "case" ? "border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" : ""} onClick={() => setMode("case")}><MapPin />Phản ánh hiện trường</Button>
          <Button aria-pressed={mode === "lookup"} variant={mode === "lookup" ? "secondary" : "quiet"} className={mode !== "lookup" ? "border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" : ""} onClick={() => setMode("lookup")}><FileSearch />Tra cứu hồ sơ</Button>
          {onGoToLogin && <Button variant="quiet" className="border border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onGoToLogin}><Lock />Đăng nhập cán bộ</Button>}
        </div>
      </section>

      {mode === "data" && dataError && <ErrorState description={dataError} onRetry={() => setReloadKey((value) => value + 1)} />}

      {mode === "data" && (
        <div className="space-y-5">
          <FilterBar>
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700"><span className="mb-1.5 flex items-center gap-2"><MapPin className="h-4 w-4 text-emerald-800" />Địa bàn</span><select value={selectedVillageId} onChange={(event) => setSelectedVillageId(event.target.value)} disabled={!villages.length}>{!villages.length && <option value="">Chưa có danh mục thôn</option>}{villages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700"><span className="mb-1.5 block">Kỳ công bố</span><select value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}><option value="all_time">Bản công bố mới nhất</option>{periods.map((period) => <option key={period} value={period}>{period}</option>)}</select></label>
            </div>
            <DataScope period={periodLabel} scope={villageName} quality={updatedLabel} qualityLabel="Cập nhật" />
          </FilterBar>

          {isLoading ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-slate-600"><RefreshCw className="h-5 w-5 animate-spin" />Đang tải dữ liệu công khai…</div> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {PUBLIC_INDICATORS.map((indicator) => { const rawValue = values[indicator.code]; const hasValue = typeof rawValue === "number" && Number.isFinite(rawValue); const Icon = indicator.icon; return <MetricCard key={indicator.code} label={`${indicator.code} · ${indicator.name}`} value={formatPublicIndicatorValue(rawValue)} unit={hasValue ? indicator.unit : undefined} context={hasValue ? `Nguồn: bản công bố ${periodLabel}` : "Chưa có dữ liệu được công bố"} tone={indicator.tone} icon={<Icon />} />; })}
            </div>
          )}

          <SectionCard className="flex flex-col gap-4 p-5 md:flex-row md:items-start">
            <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-800" />
            <div><h2 className="font-bold text-slate-900">Phạm vi công khai và quyền riêng tư</h2><p className="mt-1 text-sm leading-relaxed text-slate-600">Cổng chỉ hiển thị CT01, CT02, CT09, CT12 và CT13 sau khi được công bố. CT14 và dữ liệu nhận diện cá nhân không xuất hiện trong phản hồi công khai.</p></div>
          </SectionCard>

          <SectionCard className="p-5">
            <div className="flex items-start gap-3">
              <Navigation className="mt-0.5 h-6 w-6 shrink-0 text-emerald-800" />
              <div>
                <h2 className="font-bold text-slate-900">Điểm sơ tán đã xác minh</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">Danh mục chuẩn bị ứng phó do cơ quan có thẩm quyền xác minh. Đây không phải kênh phát cảnh báo khẩn cấp; khi có sự cố, hãy theo hướng dẫn chính thức.</p>
              </div>
            </div>
            {evacuationPoints.length === 0 ? <div className="mt-4"><EmptyState title="Chưa có điểm sơ tán công khai" description="Danh mục sẽ hiển thị sau khi được xác minh và công bố." /></div> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evacuationPoints.map((point) => { const pointVillage = villages.find((village) => village.id === point.village_id)?.name || "Toàn xã"; return <article key={point.id} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4"><div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-slate-900">{point.name}</h3><StatusBadge status="approved" label="Đã xác minh" /></div><p className="mt-2 text-sm text-slate-700">{pointVillage}</p><p className="mt-1 text-sm text-slate-600">Sức chứa dự kiến: <strong>{point.capacity_households.toLocaleString("vi-VN")} hộ</strong></p><a className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline" href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" />Mở vị trí bản đồ</a></article>; })}</div>}
          </SectionCard>

          <section className="public-place-story" aria-labelledby="public-place-story-title">
            <header className="public-place-story__intro">
              <p className="public-place-story__eyebrow">PHẠM VI QUẢN LÝ DỮ LIỆU</p>
              <h2 id="public-place-story-title">Thông tin địa bàn xã Bà Nà</h2>
              <p>Hệ thống tổng hợp dữ liệu theo thôn, kỳ báo cáo, nguồn cung cấp và trạng thái phê duyệt. Nội dung công khai được tách biệt với dữ liệu nghiệp vụ nội bộ.</p>
            </header>
            <div className="public-place-story__grid">
              <figure className="public-place-story__card public-place-story__card--feature">
                <picture>
                  <source type="image/webp" srcSet="/images/ba-na/ba-na-story-castle-720.webp 720w, /images/ba-na/ba-na-story-castle-1440.webp 1440w" sizes="(max-width: 767px) 100vw, (max-width: 1024px) 56vw, 42vw" />
                  <img src="/images/ba-na/ba-na-story-castle.jpg" width="1600" height="1066" loading="lazy" decoding="async" alt="Quần thể kiến trúc trên đỉnh Bà Nà nhìn ra dãy núi" />
                </picture>
                <figcaption><span>Đặc điểm địa bàn</span><strong>Khu vực dân cư, đồi núi, du lịch và dịch vụ được quản lý trong cùng phạm vi hành chính.</strong></figcaption>
              </figure>
              <figure className="public-place-story__card">
                <picture>
                  <source type="image/webp" srcSet="/images/ba-na/ba-na-story-clouds-720.webp 720w, /images/ba-na/ba-na-story-clouds-1200.webp 1200w" sizes="(max-width: 767px) 100vw, (max-width: 1024px) 40vw, 28vw" />
                  <img src="/images/ba-na/ba-na-story-clouds.jpg" width="1400" height="1050" loading="lazy" decoding="async" alt="Bà Nà trong biển mây lúc bình minh" />
                </picture>
                <figcaption><span>Đơn vị tổng hợp</span><strong>Số liệu được quản lý theo từng thôn và kỳ báo cáo.</strong></figcaption>
              </figure>
              <figure className="public-place-story__card">
                <picture>
                  <source type="image/webp" srcSet="/images/ba-na/ba-na-story-cable-cars-720.webp 720w, /images/ba-na/ba-na-story-cable-cars-1200.webp 1200w" sizes="(max-width: 767px) 100vw, (max-width: 1024px) 40vw, 28vw" />
                  <img src="/images/ba-na/ba-na-story-cable-cars.jpg" width="1400" height="1050" loading="lazy" decoding="async" alt="Các cabin cáp treo nối qua rừng và mây Bà Nà" />
                </picture>
                <figcaption><span>Điều kiện công khai</span><strong>Chỉ dữ liệu đã được kiểm tra và phê duyệt mới hiển thị trên cổng.</strong></figcaption>
              </figure>
            </div>
            <p className="public-place-story__credit">Ảnh tư liệu Bà Nà: Bá Ước Phùng / Pexels.</p>
          </section>
        </div>
      )}

      {mode === "lookup" && (
        <SectionCard className="mx-auto max-w-2xl p-5 md:p-8">
          <h2 className="text-xl font-bold text-slate-900">Tra cứu hồ sơ</h2>
          <p className="mt-2 text-sm text-slate-600">Dùng chung một ô tra cứu cho kiến nghị (16 ký tự) và phản ánh hiện trường (32 ký tự). Kết quả không hiển thị thông tin cá nhân.</p>
          <form onSubmit={lookupSubmission} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-sm font-semibold text-slate-700">Mã tra cứu<input value={lookupCode} onChange={(event) => setLookupCode(event.target.value.toUpperCase())} maxLength={32} minLength={16} required className="mt-1.5 font-mono tracking-wider" placeholder="MÃ TRA CỨU" /></label>
            <Button type="submit" className="sm:self-end"><FileSearch />Tra cứu</Button>
          </form>
          {lookupResult && <div role="status" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="status-badge" data-tone="info"><strong>Trạng thái:</strong> {getPublicStatusLabel(lookupResult.status)}</span>
              {lookupResult.case?.category ? <span className="status-badge"><strong>Loại phản ánh:</strong> {getPublicCaseCategoryLabel(lookupResult.case.category)}</span> : null}
            </div>
            {lookupResult.message ? <p className="mt-2 text-slate-600">{lookupResult.message}</p> : null}
          </div>}
        </SectionCard>
      )}

      {mode === "case" && <CitizenCasePanel villages={villages} onBack={() => setMode("data")} />}

      {mode === "proposal" && (
        <SectionCard className="mx-auto max-w-3xl overflow-hidden">
          <div className="border-b border-slate-200 p-5 md:p-7">
            <p className="text-xs font-bold text-emerald-800">ĐỐI CHIẾU DỮ LIỆU CÔNG KHAI</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Gửi đề nghị đối chiếu số liệu</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Biểu mẫu này chỉ dùng để đề nghị kiểm tra 5 chỉ tiêu công khai: CT01, CT02, CT09, CT12 và CT13.</p>
            <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Tiến trình gửi đề nghị đối chiếu số liệu">
              {["Số liệu", "Liên hệ", "Xác nhận"].map((label, index) => { const number = index + 1; const active = proposalStep >= number; return <li key={label} aria-current={proposalStep === number ? "step" : undefined} className={`flex items-center gap-2 border-t-2 pt-3 text-xs font-semibold ${active ? "border-emerald-700 text-emerald-900" : "border-slate-200 text-slate-400"}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${active ? "bg-emerald-800 text-white" : "bg-slate-100"}`}>{proposalStep > number ? <Check className="h-3.5 w-3.5" /> : number}</span>{label}</li>; })}
            </ol>
          </div>
          <form onSubmit={handleSubmitProposal} className="p-5 md:p-7">
            {formError && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{formError}</div>}

            {proposalStep === 1 && <div className="space-y-5"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950"><p className="font-bold">Phạm vi tiếp nhận</p><p className="mt-1">Biểu mẫu áp dụng cho CT01, CT02, CT09, CT12 và CT13. Vấn đề về đường, điện, nước, rác thải hoặc an toàn được tiếp nhận tại mục phản ánh hiện trường.</p><Button type="button" variant="secondary" className="mt-3" onClick={() => setMode("case")}><MapPin />Phản ánh hiện trường</Button></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Thôn<select className="mt-1.5" value={selectedVillageId} onChange={(event) => setSelectedVillageId(event.target.value)}>{villages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Kỳ công bố<select className="mt-1.5" value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}><option value="all_time">Bản mới nhất</option>{periods.map((period) => <option key={period}>{period}</option>)}</select></label></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(12rem,.8fr)_minmax(12rem,.8fr)]"><label className="text-sm font-semibold text-slate-700">Chỉ tiêu công khai cần đối chiếu<select className="mt-1.5" value={selectedIndicator} onChange={(event) => setSelectedIndicator(event.target.value)}>{PUBLIC_INDICATORS.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label><div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3" aria-live="polite"><p className="text-xs font-semibold text-slate-500">Giá trị đang công bố</p><p className="mt-1 text-lg font-bold text-slate-900">{hasSelectedPublishedValue ? `${formatPublicIndicatorValue(selectedPublishedValue)} ${selectedIndicatorMeta.unit}` : "Chưa có dữ liệu"}</p><p className="mt-1 text-xs text-slate-500">{periodLabel} · {updatedLabel}</p></div><label className="text-sm font-semibold text-slate-700">Giá trị đề xuất <span className="font-normal text-slate-500">({selectedIndicatorMeta.unit})</span><input className="mt-1.5" type="number" min={0} required value={suggestedValue} onChange={(event) => setSuggestedValue(event.target.value)} /></label></div><label className="block text-sm font-semibold text-slate-700">Lý do cần đối chiếu<textarea className="mt-1.5" rows={4} required value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Nêu nguồn thông tin và nội dung cần kiểm tra…" /></label><div className="flex justify-end"><Button type="button" onClick={() => goToProposalStep(2)}>Tiếp tục<ArrowRight /></Button></div></div>}

            {proposalStep === 2 && (
              <div className="space-y-6">
                <section aria-labelledby="public-proposal-contact-heading" className="rounded-xl border border-slate-200 bg-slate-25 p-4 sm:p-5">
                  <h3 id="public-proposal-contact-heading" className="text-sm font-bold text-slate-900">Thông tin người gửi</h3>
                  <p className="mt-1 text-xs text-slate-500">Chỉ trường số điện thoại là bắt buộc. Họ và tên có thể để trống.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label htmlFor="public-proposal-name" className="block text-sm font-semibold text-slate-700">
                      Họ và tên <span className="font-normal text-slate-500">(không bắt buộc)</span>
                      <input id="public-proposal-name" className="mt-1.5 w-full" type="text" value={submitterName} onChange={(event) => setSubmitterName(event.target.value)} autoComplete="name" placeholder="Ví dụ: Nguyễn Văn A" />
                    </label>
                    <label htmlFor="public-proposal-phone" className="block text-sm font-semibold text-slate-700">
                      Số điện thoại <span aria-hidden="true" className="text-rose-700">*</span>
                      <span className="relative mt-1.5 block">
                        <Phone className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                        <input id="public-proposal-phone" className="w-full pl-10!" type="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="Ví dụ: 0901 234 567" />
                      </span>
                    </label>
                  </div>
                </section>

                <div className="flex justify-between gap-3"><Button type="button" variant="secondary" onClick={() => goToProposalStep(1)}><ArrowLeft />Quay lại</Button><Button type="button" onClick={() => goToProposalStep(3)}>Tiếp tục<ArrowRight /></Button></div>
              </div>
            )}

            {proposalStep === 3 && <div className="space-y-5"><div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold text-slate-900">Kiểm tra trước khi gửi</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Phạm vi</dt><dd className="font-semibold text-slate-900">{villageName} · {periodLabel}</dd></div><div><dt className="text-slate-500">Chỉ tiêu</dt><dd className="font-semibold text-slate-900">{selectedIndicator} · {selectedIndicatorMeta.name}</dd></div><div><dt className="text-slate-500">Giá trị đang công bố</dt><dd className="font-semibold text-slate-900">{hasSelectedPublishedValue ? `${formatPublicIndicatorValue(selectedPublishedValue)} ${selectedIndicatorMeta.unit}` : "Chưa có dữ liệu"}</dd></div><div><dt className="text-slate-500">Giá trị đề xuất</dt><dd className="font-semibold text-slate-900">{Number(suggestedValue).toLocaleString("vi-VN")} {selectedIndicatorMeta.unit}</dd></div><div className="sm:col-span-2"><dt className="text-slate-500">Lý do</dt><dd className="font-semibold text-slate-900">{explanation}</dd></div></dl></div><label className="flex min-h-14 items-start gap-3 rounded-lg border border-slate-200 p-4 text-sm text-slate-700"><input type="checkbox" className="mt-0.5 h-5! min-h-5! w-5!" checked={privacyConsent} onChange={(event) => setPrivacyConsent(event.target.checked)} required /><span>Tôi đồng ý gửi số điện thoại, thông tin tùy chọn đã nhập và nội dung đề nghị để UBND xã Bà Nà xử lý theo thông báo quyền riêng tư.</span></label><div className="flex justify-between gap-3"><Button type="button" variant="secondary" onClick={() => goToProposalStep(2)}><ArrowLeft />Quay lại</Button><Button type="submit" disabled={isSending || !privacyConsent}>{isSending ? <RefreshCw className="animate-spin" /> : <ClipboardCheck />}Gửi đề nghị đối chiếu</Button></div></div>}

            {proposalStep === 4 && <div className="py-5 text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-800"><CheckCircle2 className="h-8 w-8" /></span><h3 className="mt-5 text-xl font-bold text-slate-900">Đề nghị đối chiếu đã được ghi nhận</h3><p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">Lưu mã bên dưới để theo dõi trạng thái. Trang xác nhận không hiển thị lại thông tin cá nhân của bạn.</p>{trackingCode ? <div className="mx-auto mt-5 max-w-sm rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-semibold text-emerald-800">MÃ TRA CỨU</p><p className="mt-1 select-all font-mono text-xl font-bold tracking-wider text-emerald-950">{trackingCode}</p><Button type="button" variant="secondary" className="mt-3" onClick={() => void copyTrackingCode()}><Copy />{trackingCodeCopied ? "Đã sao chép" : "Sao chép mã"}</Button></div> : <EmptyState title="Chưa nhận được mã tra cứu" description="Vui lòng liên hệ bộ phận tiếp nhận nếu bạn cần kiểm tra trạng thái." />}<Button type="button" className="mt-6" onClick={resetProposal}>Về trang dữ liệu</Button></div>}
          </form>
        </SectionCard>
      )}
    </div>
  );
}
