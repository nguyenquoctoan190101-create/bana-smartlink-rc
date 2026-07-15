import { useState, useEffect } from "react";
import { AlertCircle, AlertTriangle, Sparkles, Save, Send, Trash2, CheckCircle2, CheckSquare, Loader2, RefreshCw } from "lucide-react";
import UploadReport from "./UploadReport";
import rulesData from "../validation_rules.json";
import { ReportData, ValidationError, GeminiAnalysisResponse, IndicatorValues, ReportPeriod } from "../types";
import { saveReport, addToSyncQueue } from "../lib/db";
import { apiJson } from "../lib/apiClient";
import { useAuth } from "../lib/AuthContext";
import { useVillages } from "../lib/useVillages";
import { Button, PageHeader, SectionCard, StickyActionBar } from "./ui";

interface ReportFormProps {
  initialReport?: ReportData | null;
  onSaved: () => void;
  onCancel: () => void;
}

export default function ReportForm({ initialReport, onSaved, onCancel }: ReportFormProps) {
  const { userName, userPhone, userVillageId } = useAuth();
  const { villages: new_villages } = useVillages();
  const validationRules = rulesData as any;
  const indicatorGroups = [
    { title: "Quy mô dân cư", description: "Thông tin nền để đối chiếu các tỷ lệ và phạm vi phục vụ.", codes: ["CT01", "CT02"] },
    { title: "An sinh và trẻ em", description: "Các chỉ tiêu cần kiểm tra quan hệ với tổng hộ và tổng dân số.", codes: ["CT03", "CT04", "CT05", "CT06", "CT07", "CT08"] },
    { title: "Văn hóa, lao động và y tế", description: "Theo dõi kết quả văn hóa và độ bao phủ chính sách.", codes: ["CT09", "CT10", "CT11"] },
    { title: "Chuyển đổi số và an toàn xã hội", description: "CT14 là dữ liệu nội bộ, không được công bố trên cổng người dân.", codes: ["CT12", "CT13", "CT14"] },
  ];

  const getVillageName = (id: string) => {
    return new_villages.find((v: any) => v.id === id)?.name || id;
  };

  const [villageId, setVillageId] = useState<string>(userVillageId || "");
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [periodId, setPeriodId] = useState<string>("");
  const [reportPeriod, setReportPeriod] = useState<string>("");
  const [reporterName, setReporterName] = useState<string>(userName || "");
  const [reporterPhone, setReporterPhone] = useState<string>(userPhone || "");
  
  const [assistedByCnscd, setAssistedByCnscd] = useState<boolean>(initialReport?.assisted_by_cnscd || false);
  const [assistedMemberName, setAssistedMemberName] = useState<string>(initialReport?.assisted_member_name || "");
  
  // 14 socio-cultural indicators
  const [indicators, setIndicators] = useState<IndicatorValues>({
    CT01: null, CT02: null, CT03: null, CT04: null, CT05: null, CT06: null, CT07: null,
    CT08: null, CT09: null, CT10: null, CT11: null, CT12: null, CT13: null, CT14: null,
  });

  // Validation States
  const [localErrors, setLocalErrors] = useState<ValidationError[]>([]);
  const [localWarnings, setLocalWarnings] = useState<ValidationError[]>([]);
  
  // Optional AI narrative states
  const [aiAnalysis, setAiAnalysis] = useState<GeminiAnalysisResponse | null>(null);
  const [isAiValidating, setIsAiValidating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Status message
  const [submitMessage, setSubmitMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [reportMetadata, setReportMetadata] = useState<{ raw_source: string; source_confirmed: boolean } | null>(null);

  // User interaction and Submit Review States
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [isSubmitAttempted, setIsSubmitAttempted] = useState<boolean>(false);
  const [showSubmitReview, setShowSubmitReview] = useState<boolean>(false);
  const [isConfirmChecked, setIsConfirmChecked] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    void apiJson<ReportPeriod[]>("/report-periods")
      .then((items) => {
        if (!active) return;
        const safeItems = Array.isArray(items) ? items : [];
        setPeriods(safeItems);
        const params = new URLSearchParams(window.location.search);
        const requested = params.get("period_id") || params.get("period");
        const selected = safeItems.find((item) => item.id === requested || item.name === requested) || safeItems[0];
        if (selected && !initialReport) {
          setPeriodId(selected.id);
          setReportPeriod(selected.name);
        }
      })
      .catch(() => {
        if (active) setSubmitMessage({ type: "error", text: "Không tải được danh sách kỳ báo cáo từ máy chủ." });
      });
    return () => { active = false; };
  }, [initialReport]);

  // Load initial report if editing
  useEffect(() => {
    if (initialReport) {
      setVillageId(initialReport.village_id);
      setPeriodId(initialReport.period_id || "");
      setReportPeriod(initialReport.report_period);
      setReporterName(initialReport.reporter_name || userName || "");
      setReporterPhone(initialReport.reporter_phone || userPhone || "");
      setAssistedByCnscd(initialReport.assisted_by_cnscd || false);
      setAssistedMemberName(initialReport.assisted_member_name || "");
      setIndicators({
        CT01: initialReport.CT01,
        CT02: initialReport.CT02,
        CT03: initialReport.CT03,
        CT04: initialReport.CT04,
        CT05: initialReport.CT05,
        CT06: initialReport.CT06,
        CT07: initialReport.CT07,
        CT08: initialReport.CT08,
        CT09: initialReport.CT09,
        CT10: initialReport.CT10,
        CT11: initialReport.CT11,
        CT12: initialReport.CT12,
        CT13: initialReport.CT13,
        CT14: initialReport.CT14
      });
      // Clear analysis on load
      setAiAnalysis(null);
    }
  }, [initialReport, userName, userPhone]);

  useEffect(() => {
    if (initialReport) return;
    setReporterName(userName || "");
    setReporterPhone(userPhone || "");
    if (userVillageId) setVillageId(userVillageId);
    else if (!villageId && new_villages.length > 0) setVillageId(new_villages[0].id);
  }, [initialReport, userName, userPhone, userVillageId, villageId, new_villages]);

  // Run validation on indicator change
  useEffect(() => {
    validateIndicatorsLocally();
  }, [indicators, villageId]);

  const handleIndicatorChange = (key: string, value: string) => {
    const parsed = value.trim() === "" ? null : Number(value);
    setIndicators(prev => ({ ...prev, [key]: parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null }));
    // Reset AI analysis since data changed
    if (aiAnalysis) setAiAnalysis(null);
  };

  const handleBlur = (key: string) => {
    setTouchedFields(prev => ({ ...prev, [key]: true }));
  };

  const isFieldTouched = (key: string) => {
    if (isSubmitAttempted) return true;
    if (touchedFields[key]) return true;
    // Multi-field dependency rules:
    // If CT01 (Total households) is touched, also show validations for CT03, CT04, CT09
    if (["CT03", "CT04", "CT09"].includes(key) && touchedFields["CT01"]) return true;
    // If CT02 (Total population) is touched, also show validations for CT07, CT10, CT11
    if (["CT07", "CT10", "CT11"].includes(key) && touchedFields["CT02"]) return true;
    // If CT07 (Children <16) is touched, also show validations for CT08 (Special circumstances)
    if (key === "CT08" && touchedFields["CT07"]) return true;
    return false;
  };

  // Local Validation Logic mapped strictly to validation_rules.json
  const validateIndicatorsLocally = () => {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const [code, value] of Object.entries(indicators)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        errors.push({ field: code, message: `${code} là bắt buộc và phải là số nguyên không âm.`, severity: "error" });
      }
    }

    const CT01 = indicators.CT01 ?? 0;
    const CT02 = indicators.CT02 ?? 0;
    const CT03 = indicators.CT03 ?? 0;
    const CT04 = indicators.CT04 ?? 0;
    const CT07 = indicators.CT07 ?? 0;
    const CT08 = indicators.CT08 ?? 0;
    const CT09 = indicators.CT09 ?? 0;
    const CT10 = indicators.CT10 ?? 0;
    const CT11 = indicators.CT11 ?? 0;

    // CT02 warning check: ratio should be between 3.0 and 4.5
    if (CT01 > 0) {
      const ratio = CT02 / CT01;
      const minRatio = validationRules.CT02.warning_multiplier_min;
      const maxRatio = validationRules.CT02.warning_multiplier_max;
      if (ratio < minRatio || ratio > maxRatio) {
        warnings.push({
          field: "CT02",
          message: `${validationRules.CT02.warning_message} (Tỷ lệ hiện tại: ${ratio.toFixed(2)} lần)`,
          severity: "warning"
        });
      }
    }

    // CT03 <= CT01
    if (CT03 > CT01) {
      errors.push({
        field: "CT03",
        message: validationRules.CT03.error_message,
        severity: "error"
      });
    }

    // CT03 + CT04 <= CT01
    if ((CT03 + CT04) > CT01) {
      errors.push({
        field: "CT04",
        message: validationRules.CT04.error_message,
        severity: "error"
      });
    }

    // CT07 <= CT02
    if (CT07 > CT02) {
      errors.push({
        field: "CT07",
        message: validationRules.CT07.error_message,
        severity: "error"
      });
    }

    // CT08 <= CT07
    if (CT08 > CT07) {
      errors.push({
        field: "CT08",
        message: validationRules.CT08.error_message,
        severity: "error"
      });
    }

    // CT09 <= CT01
    if (CT09 > CT01) {
      errors.push({
        field: "CT09",
        message: validationRules.CT09.error_message,
        severity: "error"
      });
    }

    // CT10 <= CT02
    if (CT10 > CT02) {
      errors.push({
        field: "CT10",
        message: validationRules.CT10.error_message,
        severity: "error"
      });
    }

    // CT11 <= CT02
    if (CT11 > CT02) {
      errors.push({
        field: "CT11",
        message: validationRules.CT11.error_message,
        severity: "error"
      });
    }

    setLocalErrors(errors);
    setLocalWarnings(warnings);
  };

  // Draft AI analysis stays off until a scoped, privacy-reviewed API exists.
  // Deterministic validation above remains the only submission authority.
  const handleAiAudit = () => {
    setIsAiValidating(false);
    setAiError(null);
    setAiAnalysis(null);
    setAiError(
      "Diễn giải AI cho bản nháp đang tắt trong cấu hình này. " +
      "Các quy tắc kiểm tra nghiệp vụ vẫn hoạt động đầy đủ và là kết quả có thẩm quyền."
    );
  };

  // Handle successfully extracted and confirmed indicators from UploadReport component
  const handleDataExtracted = (
    extractedIndicators: Record<string, number>,
    metadata?: { raw_source: string; source_confirmed: boolean }
  ) => {
    setIndicators(prev => ({ ...prev, ...extractedIndicators }));
    if (metadata) {
      setReportMetadata(metadata);
    }
    setSubmitMessage({
      type: "success",
      text: "Đã nạp thành công 14 chỉ tiêu số liệu từ tệp vào biểu mẫu!"
    });
    setTimeout(() => setSubmitMessage(null), 5000);
  };

  // Save Report (Offline-First local storage)
  const handleSaveDraft = async () => {
    if (!reporterName.trim() || !reporterPhone.trim()) {
      setSubmitMessage({ type: "error", text: "Vui lòng nhập đầy đủ Tên và SĐT người lập báo cáo!" });
      setTimeout(() => setSubmitMessage(null), 4000);
      return;
    }

    if (!periodId || !reportPeriod) {
      setSubmitMessage({ type: "error", text: "Vui lòng chọn kỳ báo cáo hợp lệ từ máy chủ." });
      return;
    }
    const report: ReportData = {
      id: initialReport?.id || crypto.randomUUID(),
      village_id: villageId,
      period_id: periodId,
      report_period: reportPeriod,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      workflow_status: "draft",
      timeliness_status: "not_submitted",
      publication_status: "private",
      status: "Draft",
      expected_version: initialReport?.version,
      assisted_by_cnscd: assistedByCnscd,
      assisted_member_name: assistedByCnscd ? assistedMemberName : undefined,
      updated_at: new Date().toISOString(),
      raw_source: reportMetadata?.raw_source === "excel_upload" ? "excel" : reportMetadata?.raw_source === "photo_upload" ? "photo_ocr" : "manual",
      source_confirmed: reportMetadata ? reportMetadata.source_confirmed : false,
      ...indicators
    };

    try {
      await saveReport(report);
      setSubmitMessage({ type: "success", text: "Đã lưu bản nháp báo cáo thành công vào IndexedDB ngoại tuyến!" });
      setTimeout(() => {
        setSubmitMessage(null);
        onSaved();
      }, 1500);
    } catch (e) {
      setSubmitMessage({ type: "error", text: "Lỗi lưu trữ bản ghi vào IndexedDB thiết bị." });
    }
  };

  // Stage 1: deterministic validation and review
  const handleInitiateSubmit = async () => {
    setIsSubmitAttempted(true);

    // Force validation
    const errors: ValidationError[] = [...localErrors];
    const CT01 = indicators.CT01 ?? 0;
    const CT02 = indicators.CT02 ?? 0;
    const CT03 = indicators.CT03 ?? 0;
    const CT04 = indicators.CT04 ?? 0;
    const CT07 = indicators.CT07 ?? 0;
    const CT08 = indicators.CT08 ?? 0;
    const CT09 = indicators.CT09 ?? 0;
    const CT10 = indicators.CT10 ?? 0;
    const CT11 = indicators.CT11 ?? 0;

    if (!reporterName.trim() || !reporterPhone.trim()) {
      setSubmitMessage({ type: "error", text: "Vui lòng nhập đầy đủ Tên và SĐT người lập báo cáo!" });
      setTimeout(() => setSubmitMessage(null), 4000);
      return;
    }

    // Capture precise client-side validation errors
    if (CT03 > CT01) {
      errors.push({ field: "CT03", message: validationRules.CT03.error_message, severity: "error" });
    }
    if ((CT03 + CT04) > CT01) {
      errors.push({ field: "CT04", message: validationRules.CT04.error_message, severity: "error" });
    }
    if (CT07 > CT02) {
      errors.push({ field: "CT07", message: validationRules.CT07.error_message, severity: "error" });
    }
    if (CT08 > CT07) {
      errors.push({ field: "CT08", message: validationRules.CT08.error_message, severity: "error" });
    }
    if (CT09 > CT01) {
      errors.push({ field: "CT09", message: validationRules.CT09.error_message, severity: "error" });
    }
    if (CT10 > CT02) {
      errors.push({ field: "CT10", message: validationRules.CT10.error_message, severity: "error" });
    }
    if (CT11 > CT02) {
      errors.push({ field: "CT11", message: validationRules.CT11.error_message, severity: "error" });
    }

    if (errors.length > 0) {
      setSubmitMessage({ 
        type: "error", 
        text: "Không thể nộp! Số liệu báo cáo đang chứa lỗi logic nghiêm trọng. Vui lòng sửa đổi các trường báo đỏ trước khi gửi chính thức." 
      });
      setTimeout(() => setSubmitMessage(null), 6000);

      // Force-touch all fields to highlight errors immediately in the UI
      const touched: Record<string, boolean> = {};
      Object.keys(validationRules).forEach(k => {
        touched[k] = true;
      });
      setTouchedFields(touched);
      return;
    }

    if (!periodId) {
      setSubmitMessage({ type: "error", text: "Kỳ báo cáo không hợp lệ hoặc đã bị xóa." });
      return;
    }

    // Deterministic rules decide whether submission is allowed. AI narrative is optional.
    setShowSubmitReview(true);
    setIsConfirmChecked(false);
  };

  // Stage 2: Final Submit Report - records report with calculated timeliness status and queues for remote database sync
  const finalSubmitReport = async () => {
    if (!isConfirmChecked) return;

    const report: ReportData = {
      id: initialReport?.id || crypto.randomUUID(),
      village_id: villageId,
      period_id: periodId,
      report_period: reportPeriod,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      workflow_status: "submitted",
      timeliness_status: "not_submitted",
      publication_status: "private",
      status: "Submitted",
      expected_version: initialReport?.version,
      idempotency_key: initialReport?.idempotency_key || crypto.randomUUID(),
      assisted_by_cnscd: assistedByCnscd,
      assisted_member_name: assistedByCnscd ? assistedMemberName : undefined,
      updated_at: new Date().toISOString(),
      raw_source: reportMetadata?.raw_source === "excel_upload" ? "excel" : reportMetadata?.raw_source === "photo_upload" ? "photo_ocr" : "manual",
      source_confirmed: reportMetadata ? reportMetadata.source_confirmed : false,
      ...indicators
    };

    try {
      // 1. Save to local Reports table
      await saveReport(report);
      // 2. Queue into Sync Queue for remote PostgreSQL/Supabase replication
      await addToSyncQueue(report);

      const isOnline = navigator.onLine;

      if (!isOnline) {
        setSubmitMessage({
          type: "success",
          text: "Đã lưu offline — báo cáo đang chờ bạn đồng bộ khi có mạng."
        });
      } else {
        setSubmitMessage({
          type: "success",
          text: "Báo cáo đã được đưa vào hàng đợi. Chọn “Đồng bộ ngay” để máy chủ xác nhận việc nộp."
        });
      }
      
      setShowSubmitReview(false);
      
      setTimeout(() => {
        setSubmitMessage(null);
        onSaved();
      }, 3000);
    } catch (e) {
      setSubmitMessage({ type: "error", text: "Lỗi lập hàng đợi gửi dữ liệu nộp." });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Báo cáo định kỳ" title={initialReport ? "Chỉnh sửa báo cáo" : "Khai báo số liệu văn hóa – xã hội"} description="Nhập đủ 14 chỉ tiêu. Bộ quy tắc xác định sẽ kiểm tra ngay khi bạn nhập và trước lúc nộp." actions={<Button variant="quiet" onClick={onCancel}>Hủy và quay lại</Button>} />

      {/* Top Offline Notification Banner */}
      {!navigator.onLine && (
        <div id="offline-form-banner" className="mb-6 p-4 bg-amber-50/80 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
            <span className="font-medium">Bạn đang ngoại tuyến (sóng vùng núi yếu). Biểu mẫu sẽ được lưu tạm an toàn và tự động gửi lên xã khi khôi phục mạng.</span>
          </div>
          <span className="bg-amber-100 border border-amber-200 text-amber-900 text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">Chế độ Ngoại tuyến</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Indicators Form (Left 2 Columns) */}
        <div className="xl:col-span-2 space-y-6">
          {/* Metadata Section */}
          <SectionCard className="p-5">
            <div className="mb-4"><h2 className="font-bold text-slate-900">Thông tin báo cáo</h2><p className="mt-1 text-sm text-slate-600">Phạm vi, kỳ báo cáo và người chịu trách nhiệm được dùng trong nhật ký kiểm tra.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Thôn báo cáo (10 Thôn Mới):</label>
              <select
                value={villageId}
                onChange={(e) => setVillageId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              >
                {new_villages.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Kỳ báo cáo:</label>
              <select
                value={periodId}
                onChange={(e) => {
                  const selected = periods.find((period) => period.id === e.target.value);
                  setPeriodId(e.target.value);
                  setReportPeriod(selected?.name || "");
                }}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                disabled={periods.length === 0}
              >
                {periods.length === 0 && <option value="">Chưa có kỳ báo cáo</option>}
                {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Cán bộ lập báo cáo:</label>
              <input
                type="text"
                readOnly
                value={reporterName}
                placeholder="Nhập họ và tên..."
                onChange={(e) => setReporterName(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">SĐT liên hệ:</label>
              <input
                type="text"
                readOnly
                value={reporterPhone}
                placeholder="Nhập SĐT..."
                onChange={(e) => setReporterPhone(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>
            </div>
          </SectionCard>

          {/* Section: Tổ CNSCĐ hỗ trợ nhập hộ */}
          <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/20 space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="assistedByCnscd"
                checked={assistedByCnscd}
                onChange={(e) => setAssistedByCnscd(e.target.checked)}
                className="w-4.5 h-4.5 rounded-md text-emerald-600 focus:ring-emerald-600 border-slate-300 cursor-pointer"
              />
              <label htmlFor="assistedByCnscd" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                Tôi đang hỗ trợ nhập hộ (Cán bộ Tổ CNSCĐ hỗ trợ người dân/cán bộ thôn lớn tuổi)
              </label>
            </div>

            {assistedByCnscd && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 animate-fade-in">
                <div>
                  <label className="block text-4xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1">
                    Tên cán bộ CNSCĐ hỗ trợ:
                  </label>
                  <input
                    type="text"
                    value={assistedMemberName}
                    placeholder="Nhập tên thành viên Tổ CNSCĐ..."
                    onChange={(e) => setAssistedMemberName(e.target.value)}
                    className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                    required={assistedByCnscd}
                  />
                </div>
                <div className="flex items-center">
                  <p className="text-3xs text-emerald-650 leading-normal italic">
                    * Số liệu báo cáo này sẽ được thống kê đối chiếu với chỉ tiêu CT13 để đo lường và thẩm định chênh lệch khách quan.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Upload Report with Smart Assistant (Excel/Image) */}
          <UploadReport 
            onDataExtracted={handleDataExtracted} 
            onCancel={() => {}} 
          />

          {/* Indicators Input Fields */}
          <div className="space-y-5">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-850" />
              <span>14 chỉ tiêu báo cáo</span>
            </h2>

            {indicatorGroups.map((group) => <SectionCard key={group.title} className="p-5">
              <div className="mb-4"><h3 className="font-bold text-slate-900">{group.title}</h3><p className="mt-1 text-sm text-slate-600">{group.description}</p></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.codes.map((key) => {
                const rule = validationRules[key];
                const fieldErrors = localErrors.filter(e => e.field === key);
                const fieldWarnings = localWarnings.filter(w => w.field === key);
                const isTouched = isFieldTouched(key);
                
                return (
                  <div key={key} className="bg-slate-25 p-4 rounded-lg border border-slate-200 hover:border-emerald-500 transition-colors">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <label htmlFor={`input-${key}`} className="block text-sm font-semibold text-slate-800 leading-tight">
                        {rule.name} <span className="text-xs text-slate-500 font-medium">({rule.unit})</span>
                      </label>
                      <span className="text-xs font-mono font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
                        {key}
                      </span>
                    </div>
                    
                    <input
                      id={`input-${key}`}
                      type="number"
                      value={(indicators as any)[key] ?? ""}
                      min={rule.min}
                      onChange={(e) => handleIndicatorChange(key, e.target.value)}
                      onKeyDown={(e) => {
                        // Strict keyboard blocker: prevent exponent 'e', sign '+', sign '-', decimals '.' or ','
                        if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onBlur={() => handleBlur(key)}
                      className={`w-full bg-slate-25 border rounded-md px-2.5 py-1.5 text-sm font-semibold focus:bg-white focus:outline-hidden focus:ring-1 transition-all ${
                        isTouched && fieldErrors.length > 0 
                          ? "border-rose-300 focus:ring-rose-500 text-rose-900 bg-rose-25" 
                          : isTouched && fieldWarnings.length > 0 
                            ? "border-amber-300 focus:ring-amber-500 text-amber-900 bg-amber-25" 
                            : "border-slate-200 focus:ring-emerald-850 text-slate-800"
                      }`}
                    />

                    {/* Instant Business warnings directly below the input field, shown onBlur */}
                    {isTouched && fieldErrors.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 text-rose-700 text-4xs font-bold leading-normal">
                        {fieldErrors.map((err, i) => (
                          <p key={i} className="flex items-start gap-1">
                            <span className="inline-block mt-0.5 select-none text-rose-500">●</span>
                            <span>{err.message}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {isTouched && fieldWarnings.length > 0 && (
                      <div className="mt-1.5 space-y-0.5 text-amber-700 text-4xs font-bold leading-normal">
                        {fieldWarnings.map((warn, i) => (
                          <p key={i} className="flex items-start gap-1">
                            <span className="inline-block mt-0.5 select-none text-amber-500">▲</span>
                            <span>{warn.message}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </SectionCard>)}
          </div>
        </div>

        {/* Deterministic validation and optional AI narrative */}
        <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          {/* Local Auditing Panel */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-5">
            <h3 className="font-bold text-slate-700 text-sm mb-3">Đối soát nghiệp vụ tự động</h3>
            
            {localErrors.length === 0 && localWarnings.length === 0 ? (
              <div className="flex gap-2 text-xs bg-emerald-50 text-emerald-800 border border-emerald-100 p-3 rounded-lg font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Số liệu hiện tại phù hợp 100% với các ràng buộc cứng!</span>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {localErrors.map((err, idx) => (
                  <div key={`err-${idx}`} className="flex gap-2 text-xs bg-rose-50 text-rose-800 border border-rose-100 p-3 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{err.message}</span>
                  </div>
                ))}

                {localWarnings.map((warn, idx) => (
                  <div key={`warn-${idx}`} className="flex gap-2 text-xs bg-amber-50 text-amber-800 border border-amber-100 p-3 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{warn.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Optional AI narrative panel */}
          <div className="bg-gradient-to-br from-emerald-50/50 to-emerald-100/10 border border-emerald-100/70 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <Sparkles className="w-4.5 h-4.5 text-emerald-600" />
                <span>Diễn giải xu hướng bằng AI</span>
              </h3>
              <span className="bg-emerald-100 text-emerald-800 text-4xs font-bold px-1.5 py-0.5 rounded-sm">
                BẢO MẬT KHÉP KÍN
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              AI chỉ diễn giải xu hướng và đề xuất tham khảo sau khi bộ quy tắc nghiệp vụ đã kiểm tra số liệu.
              <i> AI không quyết định báo cáo hợp lệ và không tự sửa số liệu.</i>
            </p>

            {isAiValidating ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <Loader2 className="w-7 h-7 text-emerald-600 animate-spin mb-2" />
                <p className="text-xs text-slate-600 font-medium">Đang ẩn danh số liệu và phân tích...</p>
                <span className="text-3xs text-slate-400 mt-1">Đảm bảo thông tin cá nhân (SĐT, Tên) được giữ an toàn tuyệt đối.</span>
              </div>
            ) : aiAnalysis ? (
              <div className="space-y-4 animate-fade-in">
                <div className={`p-3 rounded-lg text-xs font-semibold ${aiAnalysis.is_valid ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-rose-50 text-rose-800 border border-rose-100"}`}>
                  Đã tạo diễn giải tham khảo từ AI
                </div>

                {aiAnalysis.errors && aiAnalysis.errors.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-rose-800 block mb-1">Thông tin chưa thể diễn giải:</span>
                    <ul className="list-disc pl-4 space-y-1 text-2xs text-rose-700">
                      {aiAnalysis.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                    </ul>
                  </div>
                )}

                {aiAnalysis.warnings && aiAnalysis.warnings.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-amber-800 block mb-1">Cảnh báo AI:</span>
                    <ul className="list-disc pl-4 space-y-1 text-2xs text-amber-700">
                      {aiAnalysis.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                  <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg">
                    <span className="text-xs font-bold text-emerald-950 block mb-1">Khuyến nghị của AI cho xã:</span>
                    <ul className="list-disc pl-4 space-y-1 text-2xs text-emerald-800 leading-relaxed">
                      {aiAnalysis.recommendations.map((r, idx) => <li key={idx}>{r}</li>)}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => setAiAnalysis(null)}
                  className="w-full text-center text-xs text-emerald-600 font-semibold hover:text-emerald-800"
                >
                  Xóa kết quả phân tích
                </button>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={handleAiAudit}
                  disabled={localErrors.length > 0}
                  className={`w-full py-2.5 rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all ${
                    localErrors.length > 0
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white active:scale-98"
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Tạo diễn giải AI (không bắt buộc)</span>
                </button>
                {localErrors.length > 0 && (
                  <span className="text-3xs text-rose-500 text-center block mt-1">Khắc phục lỗi nghiệp vụ đỏ trước khi chạy AI</span>
                )}
              </div>
            )}

            {aiError && (
              <div className="text-2xs text-rose-600 mt-2 p-2 bg-rose-50 border border-rose-100 rounded leading-relaxed">
                {aiError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submit Status Message */}
      {submitMessage && (
        <div className={`mt-6 p-4 rounded-lg text-xs font-semibold border ${
          submitMessage.type === "success" 
            ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
            : "bg-rose-50 text-rose-800 border-rose-100"
        } flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in`}>
          <div className="flex items-center gap-2">
            <AlertCircle className={`w-4 h-4 ${submitMessage.type === "success" ? "text-emerald-600" : "text-rose-600"}`} />
            <span>{submitMessage.text}</span>
          </div>
          {submitMessage.type === "success" && (submitMessage.text.includes("offline") || !navigator.onLine) && (
            <span id="offline-submit-badge" className="inline-flex items-center bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg text-3xs font-extrabold uppercase tracking-wider border border-amber-200 shrink-0">
              ⚡ Đã lưu offline — sẽ tự nộp khi có mạng
            </span>
          )}
        </div>
      )}

      {/* Actions Toolbar */}
      <StickyActionBar>
        <Button
          type="button"
          onClick={handleSaveDraft}
          variant="secondary"
        >
          <Save className="w-4 h-4 text-slate-500" />
          <span>Lưu nháp cục bộ</span>
        </Button>

        <Button
          type="button"
          onClick={handleInitiateSubmit}
          disabled={localErrors.length > 0}
        >
          <Send className="w-4 h-4" />
          <span>Nộp & Đồng bộ lên Xã</span>
        </Button>
      </StickyActionBar>

      {/* Submit Review Overlay Modal */}
      {showSubmitReview && (
        <div className="fixed inset-0 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-150 overflow-hidden animate-scale-in">
            {/* Modal Header */}
            <div className="bg-emerald-950 p-5 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse animate-duration-1000 shrink-0" />
                <div>
                  <h3 className="font-bold text-sm text-left">Kiểm tra quy tắc & xác nhận nộp báo cáo</h3>
                  <p className="text-4xs text-emerald-200 text-left mt-0.5">
                    Đơn vị: {getVillageName(villageId)} | Kỳ báo cáo: {reportPeriod}
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 text-slate-700 text-left">
              {/* Due Date & Submission Status */}
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-500">Hạn chót nộp số liệu:</span>
                  <span className="font-bold text-slate-800">
                    {periods.find((period) => period.id === periodId)?.due_date
                      ? new Date(periods.find((period) => period.id === periodId)!.due_date).toLocaleString("vi-VN")
                      : "Chưa cấu hình"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-500">Thời gian hiện tại:</span>
                  <span className="font-bold text-slate-800">{new Date().toLocaleDateString("vi-VN")}</span>
                </div>
                <div className="border-t border-slate-200/55 pt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Đánh giá tiến độ:</span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">Máy chủ xác định khi nộp</span>
                </div>
              </div>

              {/* Local validation warning block if any */}
              {localWarnings.length > 0 && (
                <div className="p-4 bg-amber-25 border border-amber-100 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>Cảnh báo tỷ lệ nghiệp vụ cục bộ:</span>
                  </h4>
                  <ul className="list-disc pl-4 space-y-1 text-2xs text-amber-700 font-semibold leading-relaxed">
                    {localWarnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Optional AI narrative */}
              <div className="space-y-3">
                <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wider">Diễn giải AI tùy chọn:</h4>
                
                {isAiValidating ? (
                  <div className="p-8 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-slate-25">
                    <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                    <p className="text-xs text-slate-600 font-bold animate-pulse text-center">
                      Đang tạo diễn giải xu hướng từ dữ liệu đã ẩn danh...
                    </p>
                    <span className="text-4xs text-slate-400">Hệ thống tuân thủ quy tắc bảo vệ dữ liệu cá nhân</span>
                  </div>
                ) : aiAnalysis ? (
                  <div className="space-y-4">
                    {/* General validity badge */}
                    <div className={`p-3.5 rounded-lg border flex items-center gap-2.5 ${
                      aiAnalysis.is_valid && aiAnalysis.errors.length === 0
                        ? "bg-emerald-25 border-emerald-100 text-emerald-800" 
                        : "bg-rose-25 border-rose-100 text-rose-800"
                    }`}>
                      {aiAnalysis.is_valid && aiAnalysis.errors.length === 0 ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                      )}
                      <div>
                        <span className="text-xs font-bold block">
                          {aiAnalysis.is_valid && aiAnalysis.errors.length === 0 
                            ? "Số liệu đạt chuẩn logic" 
                            : "Có nội dung cần người dùng xem lại"}
                        </span>
                        <span className="text-3xs text-slate-500 leading-normal block mt-0.5">
                          {aiAnalysis.is_valid && aiAnalysis.errors.length === 0 
                            ? "Nội dung này chỉ mang tính tham khảo; kết quả kiểm tra quy tắc ở trên mới quyết định việc nộp." 
                            : "Vui lòng xem nội dung tham khảo bên dưới."}
                        </span>
                      </div>
                    </div>

                    {/* AI Errors List */}
                    {aiAnalysis.errors && aiAnalysis.errors.length > 0 && (
                      <div className="p-3.5 bg-rose-25 border border-rose-100 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-rose-850 block">Mâu thuẫn số liệu nghiêm trọng:</span>
                        <ul className="list-disc pl-4 space-y-1 text-2xs text-rose-700 font-semibold leading-relaxed">
                          {aiAnalysis.errors.map((e, idx) => <li key={idx}>{e}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* AI Warnings List */}
                    {aiAnalysis.warnings && aiAnalysis.warnings.length > 0 && (
                      <div className="p-3.5 bg-amber-25/40 border border-amber-100 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-amber-850 block">Cảnh báo xu hướng bất thường:</span>
                        <ul className="list-disc pl-4 space-y-1 text-2xs text-amber-700 font-semibold leading-relaxed">
                          {aiAnalysis.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* AI Recommendations */}
                    {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                      <div className="p-3.5 bg-emerald-25/55 border border-emerald-100 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-emerald-950 block">Ý kiến tham mưu định hướng văn hóa xã hội:</span>
                        <ul className="list-disc pl-4 space-y-1 text-2xs text-emerald-800 leading-relaxed">
                          {aiAnalysis.recommendations.map((r, idx) => <li key={idx}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 font-semibold leading-relaxed">
                    Chưa yêu cầu diễn giải AI. Đây là bước tùy chọn và không ảnh hưởng đến việc nộp báo cáo.
                  </div>
                )}
              </div>

              {/* User pledge confirmation checkbox */}
              <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="confirm-pledge-modal"
                  checked={isConfirmChecked}
                  onChange={(e) => setIsConfirmChecked(e.target.checked)}
                  className="w-4.5 h-4.5 mt-0.5 rounded text-emerald-800 focus:ring-emerald-800 border-slate-300 cursor-pointer"
                />
                <label htmlFor="confirm-pledge-modal" className="text-xs font-bold text-slate-700 leading-normal cursor-pointer select-none">
                  Tôi cam đoan toàn bộ 14 số liệu khai báo cho thôn {getVillageName(villageId)} trong {reportPeriod} là hoàn toàn chính xác, trung thực, đã đối chiếu và chịu trách nhiệm pháp lý.
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-150 p-4 flex gap-3 justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowSubmitReview(false)}
                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors"
              >
                Quay lại sửa số liệu
              </button>
              <button
                type="button"
                onClick={finalSubmitReport}
                disabled={!isConfirmChecked}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-md transition-all flex items-center gap-1.5 ${
                  isConfirmChecked 
                    ? "bg-emerald-800 hover:bg-emerald-950 active:scale-98 cursor-pointer" 
                    : "bg-slate-300 cursor-not-allowed text-slate-500"
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Tôi xác nhận Nộp chính thức</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
