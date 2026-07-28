import { useState, useEffect, useMemo, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Sparkles,
  Save,
  Send,
  Trash2,
  CheckCircle2,
  CheckSquare,
  Loader2,
  RefreshCw,
} from "lucide-react";
import UploadReport from "./UploadReport";
import rulesData from "../validation_rules.json";
import {
  ReportData,
  ValidationError,
  GeminiAnalysisResponse,
  IndicatorValues,
  ReportPeriod,
  ExtractionCorrection,
  ExtractionMetadata,
} from "../types";
import {
  getLocalDraftForScope,
  queueReportForSync,
  saveDraftForScope,
} from "../lib/db";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { syncQueuedReports } from "../lib/reportSync";
import { validateReportIndicators } from "../lib/reportValidation";
import { useAuth } from "../lib/AuthContext";
import { useVillages } from "../lib/useVillages";
import { useReportPeriods } from "../lib/useReportPeriods";
import "./ReportForm.css";
import { Button, PageHeader, SectionCard, StickyActionBar } from "./ui";

interface ReportFormProps {
  initialReport?: ReportData | null;
  initialPeriodId?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

type ReportImportMetadata = {
  raw_source: string;
  source_confirmed: boolean;
  extraction_corrections?: ExtractionCorrection[];
  extraction_metadata?: ExtractionMetadata;
  extraction_review_token?: string;
};

export function resolveRequestedReportPeriod(
  periods: ReportPeriod[],
  requested?: string | null,
): ReportPeriod | null {
  if (!requested) return periods[0] || null;
  const periodById = periods.find((period) => period.id === requested);
  if (periodById) return periodById;

  // Old links used the display name. Keep them working only while that name
  // identifies exactly one period; duplicate names must never select a period
  // arbitrarily because reports are keyed by the period UUID.
  const periodsByName = periods.filter((period) => period.name === requested);
  return periodsByName.length === 1 ? periodsByName[0] : null;
}

export function getDraftSavedMessage(
  villageName: string,
  reportPeriod: string,
): string {
  return `Đã lưu bản nháp cục bộ trên thiết bị này cho ${villageName} · kỳ ${reportPeriod}. Bản nháp chưa được gửi lên xã và sẽ tự nạp lại khi bạn mở đúng thôn/kỳ trên thiết bị này.`;
}

export function shouldReturnAfterSubmission(
  online: boolean,
  acceptedByServer: boolean,
): boolean {
  return !online || acceptedByServer;
}

export default function ReportForm({
  initialReport,
  initialPeriodId,
  onSaved,
  onCancel,
}: ReportFormProps) {
  const {
    userName,
    userPhone,
    userVillageId,
    userVillageIds = [],
    userRole,
  } = useAuth();
  const { villages: new_villages } = useVillages();
  const { periods, error: periodsError } = useReportPeriods();
  const validationRules = rulesData as any;
  const indicatorGroups = [
    {
      title: "Quy mô dân cư",
      description: "Thông tin nền để đối chiếu các tỷ lệ và phạm vi phục vụ.",
      codes: ["CT01", "CT02"],
    },
    {
      title: "An sinh và trẻ em",
      description:
        "Các chỉ tiêu cần kiểm tra quan hệ với tổng hộ và tổng dân số.",
      codes: ["CT03", "CT04", "CT05", "CT06", "CT07", "CT08"],
    },
    {
      title: "Văn hóa, lao động và y tế",
      description: "Theo dõi kết quả văn hóa và độ bao phủ chính sách.",
      codes: ["CT09", "CT10", "CT11"],
    },
    {
      title: "Chuyển đổi số và an toàn xã hội",
      description:
        "CT14 là dữ liệu nội bộ, không được công bố trên cổng người dân.",
      codes: ["CT12", "CT13", "CT14"],
    },
  ];
  const indicatorGuidance: Partial<Record<keyof IndicatorValues, string>> = {
    CT05: "Chỉ nhập số người có công còn đang được quản lý trong danh sách nghiệp vụ của thôn tại thời điểm báo cáo. Không tự cộng số thân nhân hoặc người đã qua đời; trường hợp chưa rõ, lưu nháp và đối chiếu danh sách chính sách.",
    CT14: "Chỉ tiêu nội bộ: không công bố trên cổng người dân và không gửi vào luồng diễn giải AI.",
  };

  const getVillageName = (id: string) => {
    return new_villages.find((v: any) => v.id === id)?.name || id;
  };
  const staffVillageIds = useMemo(
    () =>
      userRole === "can_bo_thon"
        ? userVillageId
          ? [userVillageId]
          : []
        : userRole === "to_cnscd"
          ? userVillageIds
          : [],
    [userRole, userVillageId, userVillageIds],
  );
  const selectableVillages = useMemo(
    () =>
      userRole === "can_bo_thon" || userRole === "to_cnscd"
        ? new_villages.filter((village) => staffVillageIds.includes(village.id))
        : new_villages,
    [new_villages, staffVillageIds, userRole],
  );

  const [villageId, setVillageId] = useState<string>(userVillageId || "");
  const [periodId, setPeriodId] = useState<string>("");
  const [reportPeriod, setReportPeriod] = useState<string>("");
  const [reporterName, setReporterName] = useState<string>(userName || "");
  const [reporterPhone, setReporterPhone] = useState<string>(userPhone || "");

  const [assistedByCnscd, setAssistedByCnscd] = useState<boolean>(
    initialReport?.assisted_by_cnscd || false,
  );
  const canRecordCnscdAssistance = userRole === "to_cnscd";
  const effectiveAssistedByCnscd = canRecordCnscdAssistance && assistedByCnscd;
  const verifiedAssistantName = (
    initialReport?.assisted_by_cnscd && initialReport.assisted_member_name
      ? initialReport.assisted_member_name
      : userName || ""
  ).trim();

  // 14 socio-cultural indicators
  const [indicators, setIndicators] = useState<IndicatorValues>({
    CT01: null,
    CT02: null,
    CT03: null,
    CT04: null,
    CT05: null,
    CT06: null,
    CT07: null,
    CT08: null,
    CT09: null,
    CT10: null,
    CT11: null,
    CT12: null,
    CT13: null,
    CT14: null,
  });

  // Validation States
  const [localErrors, setLocalErrors] = useState<ValidationError[]>([]);
  const [localWarnings, setLocalWarnings] = useState<ValidationError[]>([]);

  // Optional AI narrative states
  const [aiAnalysis, setAiAnalysis] = useState<GeminiAnalysisResponse | null>(
    null,
  );
  const [isAiValidating, setIsAiValidating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Status message
  const [submitMessage, setSubmitMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [reportMetadata, setReportMetadata] =
    useState<ReportImportMetadata | null>(null);
  const [draftId, setDraftId] = useState<string | null>(
    initialReport?.id || null,
  );
  const [recoverableDraft, setRecoverableDraft] = useState<ReportData | null>(
    null,
  );
  const [dismissedDraftId, setDismissedDraftId] = useState<string | null>(null);

  // User interaction and Submit Review States
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {},
  );
  const [isSubmitAttempted, setIsSubmitAttempted] = useState<boolean>(false);
  const [showSubmitReview, setShowSubmitReview] = useState<boolean>(false);
  const [isConfirmChecked, setIsConfirmChecked] = useState<boolean>(false);
  const [isSubmittingReport, setIsSubmittingReport] =
    useState<boolean>(false);
  const submitDialogRef = useRef<HTMLDivElement>(null);
  const submitCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showSubmitReview) return undefined;
    const dialog = submitDialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    submitCancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowSubmitReview(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ) as HTMLElement[];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [showSubmitReview]);

  useEffect(() => {
    if (initialReport || periods.length === 0) return;
    if (periodId && periods.some((period) => period.id === periodId)) return;
    const params = new URLSearchParams(window.location.search);
    const requested =
      initialPeriodId || params.get("period_id") || params.get("period");
    const selected = resolveRequestedReportPeriod(periods, requested);
    if (!selected) {
      setPeriodId("");
      setReportPeriod("");
      setSubmitMessage({
        type: "error",
        text: "Kỳ báo cáo được yêu cầu không tồn tại hoặc bạn không còn quyền truy cập. Hãy chọn một kỳ hợp lệ.",
      });
      return;
    }
    setPeriodId(selected.id);
    setReportPeriod(selected.name);
  }, [initialPeriodId, initialReport, periodId, periods]);

  useEffect(() => {
    if (periodsError) {
      setSubmitMessage({
        type: "error",
        text: "Không tải được danh sách kỳ báo cáo từ máy chủ.",
      });
    }
  }, [periodsError]);

  // Load initial report if editing
  useEffect(() => {
    if (initialReport) {
      setDraftId(initialReport.id);
      setVillageId(initialReport.village_id);
      setPeriodId(initialReport.period_id || "");
      setReportPeriod(initialReport.report_period);
      setReporterName(initialReport.reporter_name || userName || "");
      setReporterPhone(initialReport.reporter_phone || userPhone || "");
      setAssistedByCnscd(initialReport.assisted_by_cnscd || false);
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
        CT14: initialReport.CT14,
      });
      // Clear analysis on load
      setAiAnalysis(null);
    }
  }, [initialReport, userName, userPhone]);

  useEffect(() => {
    if (initialReport || !villageId || !periodId) {
      setRecoverableDraft(null);
      return;
    }
    let cancelled = false;
    void getLocalDraftForScope(villageId, periodId)
      .then((draft) => {
        if (!cancelled)
          setRecoverableDraft(draft?.id === dismissedDraftId ? null : draft);
      })
      .catch(() => {
        if (!cancelled) setRecoverableDraft(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dismissedDraftId, initialReport, periodId, villageId]);

  const restoreLocalDraft = () => {
    if (!recoverableDraft) return;
    setDraftId(recoverableDraft.id);
    setReporterName(userName || "");
    setReporterPhone(userPhone || "");
    // A local draft cannot establish assistance provenance. Only the
    // authenticated CNSCĐ profile may opt in and the server derives its name.
    setAssistedByCnscd(
      canRecordCnscdAssistance && Boolean(recoverableDraft.assisted_by_cnscd),
    );
    setIndicators({
      CT01: recoverableDraft.CT01,
      CT02: recoverableDraft.CT02,
      CT03: recoverableDraft.CT03,
      CT04: recoverableDraft.CT04,
      CT05: recoverableDraft.CT05,
      CT06: recoverableDraft.CT06,
      CT07: recoverableDraft.CT07,
      CT08: recoverableDraft.CT08,
      CT09: recoverableDraft.CT09,
      CT10: recoverableDraft.CT10,
      CT11: recoverableDraft.CT11,
      CT12: recoverableDraft.CT12,
      CT13: recoverableDraft.CT13,
      CT14: recoverableDraft.CT14,
    });
    setReportMetadata(
      recoverableDraft.raw_source
        ? {
            raw_source: recoverableDraft.raw_source,
            source_confirmed: Boolean(recoverableDraft.source_confirmed),
            extraction_corrections: recoverableDraft.extraction_corrections,
            extraction_metadata: recoverableDraft.extraction_metadata,
            extraction_review_token: recoverableDraft.extraction_review_token,
          }
        : null,
    );
    setRecoverableDraft(null);
    setSubmitMessage({
      type: "success",
      text: "Đã khôi phục bản nháp gần nhất cho thôn và kỳ báo cáo này.",
    });
  };

  useEffect(() => {
    if (initialReport) return;
    setReporterName(userName || "");
    setReporterPhone(userPhone || "");
    if (
      villageId &&
      selectableVillages.some((village) => village.id === villageId)
    ) {
      return;
    }
    setVillageId(selectableVillages[0]?.id || "");
  }, [
    initialReport,
    userName,
    userPhone,
    villageId,
    selectableVillages,
  ]);

  // Run validation on indicator change
  useEffect(() => {
    validateIndicatorsLocally();
  }, [indicators, villageId]);

  const handleIndicatorChange = (key: string, value: string) => {
    if (reportMetadata?.extraction_review_token) return;
    const parsed = value.trim() === "" ? null : Number(value);
    setIndicators((prev) => ({
      ...prev,
      [key]:
        parsed !== null && Number.isInteger(parsed) && parsed >= 0
          ? parsed
          : null,
    }));
    // Reset AI analysis since data changed
    if (aiAnalysis) setAiAnalysis(null);
  };

  const handleBlur = (key: string) => {
    setTouchedFields((prev) => ({ ...prev, [key]: true }));
  };

  const isFieldTouched = (key: string) => {
    if (isSubmitAttempted) return true;
    if (touchedFields[key]) return true;
    // Multi-field dependency rules:
    // If CT01 (Total households) is touched, also show validations for CT03, CT04, CT09
    if (["CT03", "CT04", "CT09"].includes(key) && touchedFields["CT01"])
      return true;
    // If CT02 (Total population) is touched, also show validations for CT07, CT10, CT11
    if (["CT07", "CT10", "CT11"].includes(key) && touchedFields["CT02"])
      return true;
    // If CT07 (Children <16) is touched, also show validations for CT08 (Special circumstances)
    if (key === "CT08" && touchedFields["CT07"]) return true;
    return false;
  };

  // Do not present a wall of errors before the user has interacted with the
  // report.  All values are still checked strictly when the user submits.
  const visibleErrors = isSubmitAttempted
    ? localErrors
    : localErrors.filter((error) => isFieldTouched(error.field));
  const visibleWarnings = isSubmitAttempted
    ? localWarnings
    : localWarnings.filter((warning) => isFieldTouched(warning.field));
  const pendingRequiredFields = localErrors.filter(
    (error) => !isFieldTouched(error.field),
  ).length;

  // Local Validation Logic mapped strictly to validation_rules.json
  const validateIndicatorsLocally = () => {
    const result = validateReportIndicators(indicators);
    setLocalErrors(result.errors);
    setLocalWarnings(result.warnings);
    return result;
  };

  // The server receives only aggregate values that have passed deterministic
  // validation. The deterministic validator remains the sole submission authority.
  const handleAiAudit = async () => {
    setIsAiValidating(true);
    setAiError(null);
    setAiAnalysis(null);
    try {
      const analysis = await apiJson<GeminiAnalysisResponse>(
        "/reports/ai-narrative",
        {
          method: "POST",
          body: JSON.stringify({
            values: indicators,
            period_name: reportPeriod || undefined,
          }),
        },
      );
      setAiAnalysis(analysis);
    } catch (error) {
      const message = toUserFacingError(
        error,
        "Không thể tạo diễn giải AI vào lúc này.",
      );
      setAiError(
        `${message} Bạn vẫn có thể tiếp tục dựa trên kiểm tra nghiệp vụ ở bên trên.`,
      );
    } finally {
      setIsAiValidating(false);
    }
  };

  // Handle successfully extracted and confirmed indicators from UploadReport component
  const handleDataExtracted = (
    extractedIndicators: Record<string, number | null>,
    metadata?: ReportImportMetadata,
  ) => {
    setIndicators((prev) => ({ ...prev, ...extractedIndicators }));
    if (metadata) {
      setReportMetadata(metadata);
    }
    setSubmitMessage({
      type: "success",
      text: "Đã nhập 14 chỉ tiêu từ tệp vào biểu mẫu.",
    });
    setTimeout(() => setSubmitMessage(null), 5000);
  };

  // Save Report (Offline-First local storage)
  const handleSaveDraft = async () => {
    if (!reporterName.trim() || !reporterPhone.trim()) {
      setSubmitMessage({
        type: "error",
        text: "Vui lòng nhập đầy đủ họ tên và số điện thoại người lập báo cáo.",
      });
      setTimeout(() => setSubmitMessage(null), 4000);
      return;
    }

    if (!periodId || !reportPeriod) {
      setSubmitMessage({
        type: "error",
        text: "Vui lòng chọn kỳ báo cáo hợp lệ từ máy chủ.",
      });
      return;
    }
    const report: ReportData = {
      id: draftId || initialReport?.id || crypto.randomUUID(),
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
      assisted_by_cnscd: effectiveAssistedByCnscd,
      assisted_member_name: effectiveAssistedByCnscd
        ? verifiedAssistantName || undefined
        : undefined,
      updated_at: new Date().toISOString(),
      raw_source:
        reportMetadata?.raw_source === "excel_upload"
          ? "excel"
          : reportMetadata?.raw_source === "photo_upload"
            ? "photo_ocr"
            : "manual",
      source_confirmed: reportMetadata
        ? reportMetadata.source_confirmed
        : false,
      extraction_corrections: reportMetadata?.extraction_corrections,
      extraction_metadata: reportMetadata?.extraction_metadata,
      extraction_review_token: reportMetadata?.extraction_review_token,
      ...indicators,
    };

    try {
      const savedDraft = await saveDraftForScope(report);
      setDraftId(savedDraft.id);
      setSubmitMessage({
        type: "success",
        text: getDraftSavedMessage(getVillageName(villageId), reportPeriod),
      });
      // Keep the form open so the user can continue editing this local-only draft.
      setTimeout(() => setSubmitMessage(null), 8000);
    } catch (e) {
      setSubmitMessage({
        type: "error",
        text: "Không thể lưu bản nháp trên thiết bị. Hãy kiểm tra dung lượng trình duyệt và thử lại.",
      });
    }
  };

  // Stage 1: deterministic validation and review
  const handleInitiateSubmit = async () => {
    setIsSubmitAttempted(true);

    // Recalculate synchronously so submission never relies on stale React state.
    const { errors, warnings } = validateReportIndicators(indicators);
    setLocalErrors(errors);
    setLocalWarnings(warnings);

    if (!reporterName.trim() || !reporterPhone.trim()) {
      setSubmitMessage({
        type: "error",
        text: "Vui lòng nhập đầy đủ họ tên và số điện thoại người lập báo cáo.",
      });
      setTimeout(() => setSubmitMessage(null), 4000);
      return;
    }

    if (errors.length > 0) {
      setSubmitMessage({
        type: "error",
        text: "Chưa thể tiếp tục vì còn lỗi dữ liệu. Vui lòng sửa các trường được đánh dấu.",
      });
      setTimeout(() => setSubmitMessage(null), 6000);

      // Force-touch all fields to highlight errors immediately in the UI
      const touched: Record<string, boolean> = {};
      Object.keys(validationRules).forEach((k) => {
        touched[k] = true;
      });
      setTouchedFields(touched);
      return;
    }

    if (!periodId) {
      setSubmitMessage({
        type: "error",
        text: "Kỳ báo cáo không hợp lệ hoặc đã bị xóa.",
      });
      return;
    }

    // Deterministic rules decide whether submission is allowed. AI narrative is optional.
    setShowSubmitReview(true);
    setIsConfirmChecked(false);
  };

  // Stage 2: Final Submit Report - records report with calculated timeliness status and queues for remote database sync
  const finalSubmitReport = async () => {
    if (!isConfirmChecked || isSubmittingReport) return;
    setIsSubmittingReport(true);

    const report: ReportData = {
      id: draftId || initialReport?.id || crypto.randomUUID(),
      village_id: villageId,
      period_id: periodId,
      report_period: reportPeriod,
      reporter_name: reporterName,
      reporter_phone: reporterPhone,
      // The server is authoritative for submission and timeliness. Until its
      // per-item ACK arrives, the local copy remains an explicit queued draft.
      workflow_status: "draft",
      timeliness_status: "not_submitted",
      publication_status: "private",
      status: "Draft",
      pending_sync: true,
      expected_version: initialReport?.version,
      idempotency_key: initialReport?.idempotency_key || crypto.randomUUID(),
      assisted_by_cnscd: effectiveAssistedByCnscd,
      assisted_member_name: effectiveAssistedByCnscd
        ? verifiedAssistantName || undefined
        : undefined,
      updated_at: new Date().toISOString(),
      raw_source:
        reportMetadata?.raw_source === "excel_upload"
          ? "excel"
          : reportMetadata?.raw_source === "photo_upload"
            ? "photo_ocr"
            : "manual",
      source_confirmed: reportMetadata
        ? reportMetadata.source_confirmed
        : false,
      extraction_corrections: reportMetadata?.extraction_corrections,
      extraction_metadata: reportMetadata?.extraction_metadata,
      extraction_review_token: reportMetadata?.extraction_review_token,
      ...indicators,
    };

    try {
      // Store the local copy and queue item together so they cannot diverge.
      await queueReportForSync(report);
    } catch {
      setSubmitMessage({
        type: "error",
        text: "Không thể lưu báo cáo trên thiết bị. Hãy kiểm tra dung lượng trình duyệt và thử lại.",
      });
      setIsSubmittingReport(false);
      return;
    }

    setShowSubmitReview(false);

    const online = navigator.onLine;
    let shouldReturn = false;
    if (!online) {
      setSubmitMessage({
        type: "success",
        text: "Đã lưu an toàn trên thiết bị — báo cáo đang chờ gửi khi có kết nối.",
      });
      shouldReturn = shouldReturnAfterSubmission(false, false);
    } else {
      try {
        const result = await syncQueuedReports();
        const accepted = result.accepted.find(
          (item) => item.client_id === report.id,
        );
        const rejected = result.rejected.find(
          (item) => item.client_id === report.id,
        );
        if (accepted) {
          setSubmitMessage({
            type: "success",
            text: "Nộp báo cáo thành công — máy chủ đã xác nhận tiếp nhận.",
          });
          shouldReturn = shouldReturnAfterSubmission(true, true);
        } else if (rejected) {
          setSubmitMessage({
            type: "error",
            text: `${rejected.message} Báo cáo vẫn được giữ an toàn trên thiết bị để bạn xử lý hoặc gửi lại.`,
          });
        } else {
          setSubmitMessage({
            type: "error",
            text: "Máy chủ chưa xác nhận báo cáo. Dữ liệu vẫn được giữ an toàn trong hàng đợi gửi.",
          });
        }
      } catch {
        setSubmitMessage({
          type: "error",
          text: "Máy chủ chưa xác nhận việc nộp. Báo cáo vẫn được giữ an toàn trên thiết bị; hãy chọn “Đồng bộ ngay” để gửi lại.",
        });
      }
    }

    setIsSubmittingReport(false);
    if (shouldReturn) {
      setTimeout(() => {
        setSubmitMessage(null);
        onSaved();
      }, 3000);
    }
  };

  return (
    <div className="report-form-screen space-y-6">
      <PageHeader
        eyebrow="Báo cáo định kỳ"
        title={initialReport ? "Chỉnh sửa báo cáo" : "Lập báo cáo định kỳ"}
        description="Nhập đủ 14 chỉ tiêu. Bộ quy tắc nghiệp vụ kiểm tra dữ liệu khi nhập và trước khi gửi."
      />

      {/* Top Offline Notification Banner */}
      {!navigator.onLine && (
        <div
          id="offline-form-banner"
          className="mb-6 p-4 bg-amber-50/80 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-center justify-between gap-3 animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shrink-0"></span>
            <span className="font-medium">
              Bạn đang ngoại tuyến. Biểu mẫu được lưu trên thiết bị và sẽ sẵn
              sàng đồng bộ khi có kết nối.
            </span>
          </div>
          <span className="bg-amber-100 border border-amber-200 text-amber-900 text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
            Ngoại tuyến
          </span>
        </div>
      )}

      <details className="report-section-guide">
        <summary>
          <span>
            <b>7 nhóm nội dung của báo cáo</b>
            <small>Mục 1/7 · Chọn phạm vi và kỳ báo cáo</small>
          </span>
          <span className="report-section-guide__hint">
            Mở hướng dẫn
          </span>
        </summary>
        <ol aria-label="Điều hướng các nhóm nội dung của biểu mẫu">
          {[
            ["1", "Phạm vi và kỳ", "#report-section-scope"],
            ["2", "Nguồn dữ liệu", "#report-section-source"],
            ["3", "14 chỉ tiêu", "#report-section-indicators"],
            ["4", "Kiểm tra quy tắc", "#report-section-validation"],
            ["5", "Nhận xét tùy chọn", "#report-section-narrative"],
            ["6", "Xác nhận và gửi", "#report-section-submit"],
            ["7", "Theo dõi tiếp nhận", "#report-section-submit"],
          ].map(([number, title, href]) => (
            <li key={number}>
              <a href={href}>
                <span>{number}</span>
                {title}
              </a>
            </li>
          ))}
        </ol>
        <p>
          Đây là một biểu mẫu liên tục. Dữ liệu chỉ được ghi nhận sau khi cán bộ
          xác nhận và máy chủ tiếp nhận.
        </p>
      </details>

      {recoverableDraft && (
        <SectionCard
          className="border-amber-300 bg-amber-50 p-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-bold text-amber-950">
                Đã có bản nháp cho thôn và kỳ này
              </h2>
              <p className="mt-1 text-sm text-amber-900">
                Lưu gần nhất{" "}
                {recoverableDraft.updated_at
                  ? new Date(recoverableDraft.updated_at).toLocaleString(
                      "vi-VN",
                    )
                  : "trên thiết bị này"}
                . Khôi phục để tiếp tục đúng dữ liệu đang làm dở.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={restoreLocalDraft}>
                <RefreshCw className="h-4 w-4" /> Khôi phục bản nháp
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDismissedDraftId(recoverableDraft.id);
                  setRecoverableDraft(null);
                }}
              >
                Bắt đầu bản trống
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Indicators Form (Left 2 Columns) */}
        <div className="xl:col-span-2 space-y-6">
          {/* Metadata Section */}
          <SectionCard id="report-section-scope" className="p-5">
            <div className="mb-4">
              <h2 className="font-bold text-slate-900">Thông tin báo cáo</h2>
              <p className="mt-1 text-sm text-slate-600">
                Phạm vi, kỳ báo cáo và người chịu trách nhiệm được dùng trong
                nhật ký kiểm tra.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="report-village"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Thôn báo cáo:
                </label>
                <select
                  id="report-village"
                  value={villageId}
                  onChange={(e) => setVillageId(e.target.value)}
                  className={`report-scope-select w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600 ${
                    (userRole === "can_bo_thon" ||
                      userRole === "to_cnscd") &&
                    selectableVillages.length <= 1
                      ? "report-scope-select--locked"
                      : "bg-white"
                  }`}
                  disabled={
                    (userRole === "can_bo_thon" || userRole === "to_cnscd") &&
                    selectableVillages.length <= 1
                  }
                >
                  {selectableVillages.length === 0 && (
                    <option value="">Chưa được phân công thôn</option>
                  )}
                  {selectableVillages.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                {userRole === "can_bo_thon" && userVillageId && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Tài khoản của bạn chỉ được lập báo cáo cho{" "}
                    <b>{getVillageName(userVillageId)}</b>. Liên hệ quản trị xã
                    nếu cần điều chỉnh phân công.
                  </p>
                )}
                {userRole === "to_cnscd" && selectableVillages.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Chỉ có thể lập báo cáo cho {selectableVillages.length} thôn
                    được quản trị xã phân công.
                  </p>
                )}
                {(userRole === "can_bo_thon" || userRole === "to_cnscd") &&
                  selectableVillages.length === 0 && (
                    <p className="mt-1.5 text-xs font-semibold text-amber-800" role="status">
                      Tài khoản chưa được phân công thôn. Liên hệ quản trị xã
                      trước khi lập báo cáo.
                    </p>
                  )}
              </div>

              <div>
                <label
                  htmlFor="report-period"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Kỳ báo cáo:
                </label>
                <select
                  id="report-period"
                  value={periodId}
                  onChange={(e) => {
                    const selected = periods.find(
                      (period) => period.id === e.target.value,
                    );
                    setPeriodId(e.target.value);
                    setReportPeriod(selected?.name || "");
                    if (selected) setSubmitMessage(null);
                  }}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                  disabled={periods.length === 0}
                >
                  {periods.length === 0 && (
                    <option value="">Chưa có kỳ báo cáo</option>
                  )}
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.display_name ?? period.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="reporter-name"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Cán bộ lập báo cáo:
                </label>
                <input
                  id="reporter-name"
                  type="text"
                  readOnly
                  value={reporterName}
                  placeholder="Nhập họ và tên..."
                  onChange={(e) => setReporterName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label
                  htmlFor="reporter-phone"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Số điện thoại liên hệ:
                </label>
                <input
                  id="reporter-phone"
                  type="text"
                  readOnly
                  value={reporterPhone}
                  placeholder="Nhập số điện thoại…"
                  onChange={(e) => setReporterPhone(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>
          </SectionCard>

          {/* Section: Tổ CNSCĐ hỗ trợ nhập hộ */}
          {canRecordCnscdAssistance && (
            <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/20 space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="assistedByCnscd"
                  checked={assistedByCnscd}
                  onChange={(e) => setAssistedByCnscd(e.target.checked)}
                  className="w-4.5 h-4.5 rounded-md text-emerald-600 focus:ring-emerald-600 border-slate-300 cursor-pointer"
                />
                <div>
                  <label
                    htmlFor="assistedByCnscd"
                    className="block text-sm font-bold text-slate-800 cursor-pointer select-none"
                  >
                    Ghi nhận hỗ trợ nhập liệu
                  </label>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Chọn khi bạn là thành viên Tổ công nghệ số cộng đồng đang hỗ
                    trợ cán bộ thôn nhập báo cáo. Không chọn khi người lập tự
                    nhập báo cáo của mình.
                  </p>
                </div>
              </div>

              {effectiveAssistedByCnscd && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 animate-fade-in">
                  <div>
                    <label
                      htmlFor="cnscd-assistant-name"
                      className="block text-4xs font-extrabold uppercase tracking-wider text-emerald-700 mb-1"
                    >
                      Người thuộc Tổ công nghệ số cộng đồng hỗ trợ:
                    </label>
                    <input
                      id="cnscd-assistant-name"
                      type="text"
                      readOnly
                      value={verifiedAssistantName}
                      aria-describedby="cnscd-assistance-provenance"
                      className="w-full bg-slate-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm text-slate-700"
                    />
                  </div>
                  <div className="flex items-center">
                    <p
                      id="cnscd-assistance-provenance"
                      className="text-3xs text-emerald-650 leading-normal italic"
                    >
                      * Danh tính người hỗ trợ được lấy từ hồ sơ đăng nhập và
                      được máy chủ kiểm tra; người dùng không thể tự sửa tên
                      này.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Upload Report with Smart Assistant (Excel/Image) */}
          <div id="report-section-source" className="scroll-mt-24">
            <UploadReport
              onDataExtracted={handleDataExtracted}
              onCancel={() => {}}
            />
          </div>

          {/* Indicators Input Fields */}
          <div id="report-section-indicators" className="scroll-mt-24 space-y-5">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-850" />
              <span>14 chỉ tiêu báo cáo</span>
            </h2>
            {reportMetadata?.extraction_review_token && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
                Số liệu nhập từ tệp đã gắn bằng chứng rà soát. Muốn điều chỉnh,
                hãy xem trước lại tệp ở mục Nhập số liệu từ tệp Excel để hệ
                thống ghi đủ giá trị trước, sau và lý do.
              </p>
            )}

            {indicatorGroups.map((group) => (
              <SectionCard key={group.title} className="p-5">
                <div className="mb-4">
                  <h3 className="font-bold text-slate-900">{group.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {group.description}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.codes.map((key) => {
                    const rule = validationRules[key];
                    const fieldErrors = localErrors.filter(
                      (e) => e.field === key,
                    );
                    const fieldWarnings = localWarnings.filter(
                      (w) => w.field === key,
                    );
                    const isTouched = isFieldTouched(key);

                    return (
                      <div
                        key={key}
                        className="bg-slate-25 p-4 rounded-lg border border-slate-200 hover:border-emerald-500 transition-colors"
                      >
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <label
                            htmlFor={`input-${key}`}
                            className="block text-sm font-semibold text-slate-800 leading-tight"
                          >
                            {rule.name}{" "}
                            <span className="text-xs text-slate-500 font-medium">
                              ({rule.unit})
                            </span>
                          </label>
                          <span className="text-xs font-mono font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
                            {key}
                          </span>
                        </div>
                        {indicatorGuidance[key as keyof IndicatorValues] && (
                          <p
                            id={`guidance-${key}`}
                            className="mb-2 text-xs leading-relaxed text-slate-500"
                          >
                            {indicatorGuidance[key as keyof IndicatorValues]}
                          </p>
                        )}

                        <input
                          id={`input-${key}`}
                          type="number"
                          value={(indicators as any)[key] ?? ""}
                          min={rule.min}
                          aria-invalid={isTouched && fieldErrors.length > 0}
                          aria-describedby={
                            [
                              indicatorGuidance[key as keyof IndicatorValues]
                                ? `guidance-${key}`
                                : "",
                              isTouched && fieldErrors.length > 0
                                ? `errors-${key}`
                                : "",
                              isTouched && fieldWarnings.length > 0
                                ? `warnings-${key}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ") || undefined
                          }
                          disabled={Boolean(
                            reportMetadata?.extraction_review_token,
                          )}
                          onChange={(e) =>
                            handleIndicatorChange(key, e.target.value)
                          }
                          onKeyDown={(e) => {
                            // Strict keyboard blocker: prevent exponent 'e', sign '+', sign '-', decimals '.' or ','
                            if (
                              ["e", "E", "+", "-", ".", ","].includes(e.key)
                            ) {
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
                          <div
                            id={`errors-${key}`}
                            className="mt-1.5 space-y-0.5 text-rose-700 text-4xs font-bold leading-normal"
                          >
                            {fieldErrors.map((err, i) => (
                              <p key={i} className="flex items-start gap-1">
                                <span className="inline-block mt-0.5 select-none text-rose-500">
                                  ●
                                </span>
                                <span>{err.message}</span>
                              </p>
                            ))}
                          </div>
                        )}

                        {isTouched && fieldWarnings.length > 0 && (
                          <div
                            id={`warnings-${key}`}
                            className="mt-1.5 space-y-0.5 text-amber-700 text-4xs font-bold leading-normal"
                          >
                            {fieldWarnings.map((warn, i) => (
                              <p key={i} className="flex items-start gap-1">
                                <span className="inline-block mt-0.5 select-none text-amber-500">
                                  ▲
                                </span>
                                <span>{warn.message}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            ))}
          </div>
        </div>

        {/* Deterministic validation and optional AI narrative */}
        <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          {/* Local Auditing Panel */}
          <div
            id="report-section-validation"
            className="scroll-mt-24 bg-slate-50 border border-slate-100 rounded-xl p-5"
          >
            <h3 className="font-bold text-slate-700 text-sm mb-3">
              Kiểm tra theo quy tắc nghiệp vụ
            </h3>

            {visibleErrors.length === 0 && visibleWarnings.length === 0 ? (
              <div className="flex gap-2 text-xs bg-emerald-50 text-emerald-800 border border-emerald-100 p-3 rounded-lg font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {pendingRequiredFields > 0
                    ? `Chưa kiểm tra đủ: còn ${pendingRequiredFields} chỉ tiêu bắt buộc cần nhập.`
                    : "Số liệu hiện tại không có lỗi theo quy tắc nghiệp vụ."}
                </span>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {visibleErrors.map((err, idx) => (
                  <div
                    key={`err-${idx}`}
                    className="flex gap-2 text-xs bg-rose-50 text-rose-800 border border-rose-100 p-3 rounded-lg"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{err.message}</span>
                  </div>
                ))}

                {visibleWarnings.map((warn, idx) => (
                  <div
                    key={`warn-${idx}`}
                    className="flex gap-2 text-xs bg-amber-50 text-amber-800 border border-amber-100 p-3 rounded-lg"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>{warn.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Optional AI narrative panel */}
          <div
            id="report-section-narrative"
            className="scroll-mt-24 bg-gradient-to-br from-emerald-50/50 to-emerald-100/10 border border-emerald-100/70 rounded-xl p-5"
          >
            <div className="mb-3 flex flex-col items-start gap-2">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <Sparkles className="w-4.5 h-4.5 text-emerald-600" />
                <span>Dự thảo nhận xét số liệu (không bắt buộc)</span>
              </h3>
              <span className="inline-flex max-w-full bg-emerald-100 text-emerald-800 text-4xs font-bold px-2 py-1 rounded-sm leading-relaxed">
                KHÔNG GỬI THÔNG TIN CÁ NHÂN
              </span>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Công cụ AI chỉ tạo nội dung gợi ý sau khi quy tắc nghiệp vụ kiểm
              tra số liệu.
              <i>
                {" "}
                Nội dung này không quyết định báo cáo hợp lệ và không sửa dữ
                liệu.
              </i>
            </p>

            {isAiValidating ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <Loader2 className="w-7 h-7 text-emerald-600 animate-spin mb-2" />
                <p className="text-xs text-slate-600 font-medium">
                  Đang tạo nội dung gợi ý từ số liệu tổng hợp…
                </p>
                <span className="text-3xs text-slate-400 mt-1">
                  Họ tên, số điện thoại và CT14 không được đưa vào yêu cầu diễn
                  giải gửi tới dịch vụ AI.
                </span>
              </div>
            ) : aiAnalysis ? (
              <div className="space-y-4 animate-fade-in">
                <div
                  className={`p-3 rounded-lg text-xs font-semibold ${aiAnalysis.is_valid ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-rose-50 text-rose-800 border border-rose-100"}`}
                >
                  Nội dung gợi ý — cần cán bộ xem lại
                </div>

                {aiAnalysis.errors && aiAnalysis.errors.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-rose-800 block mb-1">
                      Thông tin chưa thể diễn giải:
                    </span>
                    <ul className="list-disc pl-4 space-y-1 text-2xs text-rose-700">
                      {aiAnalysis.errors.map((e, idx) => (
                        <li key={idx}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiAnalysis.warnings && aiAnalysis.warnings.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-amber-800 block mb-1">
                      Điểm cần lưu ý trong nội dung gợi ý:
                    </span>
                    <ul className="list-disc pl-4 space-y-1 text-2xs text-amber-700">
                      {aiAnalysis.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiAnalysis.recommendations &&
                  aiAnalysis.recommendations.length > 0 && (
                    <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg">
                      <span className="text-xs font-bold text-emerald-950 block mb-1">
                        Gợi ý kiểm tra tiếp theo:
                      </span>
                      <ul className="list-disc pl-4 space-y-1 text-2xs text-emerald-800 leading-relaxed">
                        {aiAnalysis.recommendations.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
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
                  disabled={localErrors.length > 0 || isAiValidating}
                  className={`w-full py-2.5 rounded-lg text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all ${
                    localErrors.length > 0 || isAiValidating
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-700 text-white active:scale-98"
                  }`}
                >
                  {isAiValidating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>
                    {isAiValidating
                      ? "Đang tạo nội dung…"
                      : "Tạo nội dung gợi ý (không bắt buộc)"}
                  </span>
                </button>
                {localErrors.length > 0 && (
                  <span className="text-3xs text-rose-500 text-center block mt-1">
                    Khắc phục lỗi nghiệp vụ trước khi yêu cầu diễn giải
                  </span>
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
        <div
          role={submitMessage.type === "error" ? "alert" : "status"}
          aria-live={submitMessage.type === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          className={`mt-6 p-4 rounded-lg text-xs font-semibold border ${
            submitMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-100"
              : "bg-rose-50 text-rose-800 border-rose-100"
          } flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in`}
        >
          <div className="flex items-center gap-2">
            <AlertCircle
              className={`w-4 h-4 ${submitMessage.type === "success" ? "text-emerald-600" : "text-rose-600"}`}
            />
            <span>{submitMessage.text}</span>
          </div>
          {submitMessage.type === "success" &&
            (submitMessage.text.includes("trên thiết bị") ||
              !navigator.onLine) && (
              <span
                id="offline-submit-badge"
                className="inline-flex items-center bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg text-3xs font-extrabold uppercase tracking-wider border border-amber-200 shrink-0"
              >
                Đã lưu trên thiết bị · chờ đồng bộ
              </span>
            )}
        </div>
      )}

      {/* Actions Toolbar */}
      <div id="report-section-submit" className="scroll-mt-24">
        <StickyActionBar>
          <Button type="button" onClick={onCancel} variant="quiet">
            <span className="sm:hidden">Quay lại</span>
            <span className="hidden sm:inline">Hủy và quay lại</span>
          </Button>
          <Button type="button" onClick={handleSaveDraft} variant="secondary">
            <Save className="w-4 h-4 text-slate-500" />
            <span className="sm:hidden">Lưu nháp</span>
            <span className="hidden sm:inline">Lưu nháp trên thiết bị</span>
          </Button>

          <Button
            type="button"
            onClick={handleInitiateSubmit}
            disabled={localErrors.length > 0}
          >
            <Send className="w-4 h-4" />
            <span className="sm:hidden">Kiểm tra</span>
            <span className="hidden sm:inline">Kiểm tra trước khi gửi</span>
          </Button>
        </StickyActionBar>
      </div>

      {/* Submit Review Overlay Modal */}
      {showSubmitReview && (
        <div className="fixed inset-0 z-[1100] bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div
            ref={submitDialogRef}
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85dvh] flex flex-col shadow-2xl border border-slate-150 overflow-hidden animate-scale-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-review-title"
            tabIndex={-1}
          >
            {/* Modal Header */}
            <div className="bg-emerald-950 p-5 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse animate-duration-1000 shrink-0" />
                <div>
                  <h3
                    id="submit-review-title"
                    className="font-bold text-sm text-left"
                  >
                    Kiểm tra và nộp báo cáo
                  </h3>
                  <p className="text-4xs text-emerald-200 text-left mt-0.5">
                    Đơn vị: {getVillageName(villageId)} | Kỳ báo cáo:{" "}
                    {reportPeriod}
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 text-slate-700 text-left">
              {/* Due Date & Submission Status */}
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-500">
                    Hạn chót nộp số liệu:
                  </span>
                  <span className="font-bold text-slate-800">
                    {periods.find((period) => period.id === periodId)?.due_date
                      ? new Date(
                          periods.find((period) => period.id === periodId)!
                            .due_date,
                        ).toLocaleString("vi-VN")
                      : "Chưa cấu hình"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-slate-500">
                    Thời gian hiện tại:
                  </span>
                  <span className="font-bold text-slate-800">
                    {new Date().toLocaleDateString("vi-VN")}
                  </span>
                </div>
                <div className="border-t border-slate-200/55 pt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">
                    Đánh giá tiến độ:
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                    Máy chủ xác định khi nộp
                  </span>
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
                <h4 className="text-2xs font-bold text-slate-400 uppercase tracking-wider">
                  Nội dung gợi ý tùy chọn:
                </h4>

                {isAiValidating ? (
                  <div className="p-8 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 bg-slate-25">
                    <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                    <p className="text-xs text-slate-600 font-bold animate-pulse text-center">
                      Đang tạo nội dung gợi ý từ số liệu tổng hợp…
                    </p>
                    <span className="text-4xs text-slate-400">
                      Không gửi họ tên, số điện thoại và CT14 tới dịch vụ diễn
                      giải AI
                    </span>
                  </div>
                ) : aiAnalysis ? (
                  <div className="space-y-4">
                    {/* General validity badge */}
                    <div
                      className={`p-3.5 rounded-lg border flex items-center gap-2.5 ${
                        aiAnalysis.is_valid && aiAnalysis.errors.length === 0
                          ? "bg-emerald-25 border-emerald-100 text-emerald-800"
                          : "bg-rose-25 border-rose-100 text-rose-800"
                      }`}
                    >
                      {aiAnalysis.is_valid && aiAnalysis.errors.length === 0 ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                      )}
                      <div>
                        <span className="text-xs font-bold block">
                          {aiAnalysis.is_valid && aiAnalysis.errors.length === 0
                            ? "Không còn lỗi chặn theo quy tắc"
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
                        <span className="text-xs font-bold text-rose-850 block">
                          Nội dung cần đối chiếu:
                        </span>
                        <ul className="list-disc pl-4 space-y-1 text-2xs text-rose-700 font-semibold leading-relaxed">
                          {aiAnalysis.errors.map((e, idx) => (
                            <li key={idx}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* AI Warnings List */}
                    {aiAnalysis.warnings && aiAnalysis.warnings.length > 0 && (
                      <div className="p-3.5 bg-amber-25/40 border border-amber-100 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-amber-850 block">
                          Biến động cần xem lại:
                        </span>
                        <ul className="list-disc pl-4 space-y-1 text-2xs text-amber-700 font-semibold leading-relaxed">
                          {aiAnalysis.warnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* AI Recommendations */}
                    {aiAnalysis.recommendations &&
                      aiAnalysis.recommendations.length > 0 && (
                        <div className="p-3.5 bg-emerald-25/55 border border-emerald-100 rounded-xl space-y-1.5">
                          <span className="text-xs font-bold text-emerald-950 block">
                            Gợi ý kiểm tra tiếp theo:
                          </span>
                          <ul className="list-disc pl-4 space-y-1 text-2xs text-emerald-800 leading-relaxed">
                            {aiAnalysis.recommendations.map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                ) : (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 font-semibold leading-relaxed">
                    Chưa yêu cầu nội dung gợi ý. Đây là bước tùy chọn và không
                    ảnh hưởng đến việc nộp báo cáo.
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
                <label
                  htmlFor="confirm-pledge-modal"
                  className="text-xs font-bold text-slate-700 leading-normal cursor-pointer select-none"
                >
                  Tôi xác nhận đã đối chiếu 14 chỉ tiêu của thôn{" "}
                  {getVillageName(villageId)} trong {reportPeriod} với nguồn
                  nghiệp vụ và chịu trách nhiệm về nội dung báo cáo theo quy
                  định.
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-150 p-4 flex gap-3 justify-end shrink-0">
              <button
                ref={submitCancelRef}
                type="button"
                onClick={() => setShowSubmitReview(false)}
                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-bold rounded-lg transition-colors"
              >
                Quay lại sửa số liệu
              </button>
              <button
                type="button"
                onClick={finalSubmitReport}
                disabled={!isConfirmChecked || isSubmittingReport}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold text-white shadow-md transition-all flex items-center gap-1.5 ${
                  isConfirmChecked && !isSubmittingReport
                    ? "bg-emerald-800 hover:bg-emerald-950 active:scale-98 cursor-pointer"
                    : "bg-slate-300 cursor-not-allowed text-slate-500"
                }`}
              >
                {isSubmittingReport ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>
                  {isSubmittingReport
                    ? "Đang gửi..."
                    : navigator.onLine
                      ? "Nộp báo cáo"
                      : "Lưu chờ gửi"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
