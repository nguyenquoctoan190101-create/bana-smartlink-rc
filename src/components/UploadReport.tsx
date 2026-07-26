import React, { useState, useRef } from "react";
import { 
  FileSpreadsheet, 
  Upload, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle,
  Loader2, 
  Check, 
  CheckSquare,
  X
} from "lucide-react";
import { apiUpload, toUserFacingError } from "../lib/apiClient";
import type { ExtractionCorrection, ExtractionMetadata, IndicatorCode } from "../types";

interface UploadReportProps {
  onDataExtracted: (
    indicators: Record<string, number | null>,
    metadata?: {
      raw_source: string;
      source_confirmed: boolean;
      extraction_corrections?: ExtractionCorrection[];
      extraction_metadata?: ExtractionMetadata;
      extraction_review_token?: string;
    }
  ) => void;
  onCancel: () => void;
}

type PreviewSource = "excel" | "photo_ocr" | "pdf_ocr";

interface FieldEvidence {
  raw_value?: string | number | null;
  normalized_value?: number | null;
  confidence?: number;
  source_page?: number | null;
  source_region?: string | null;
  extractor?: string;
  method?: string;
  version?: string;
  flags?: string[];
  requires_review?: boolean;
}

interface ExtractionRow {
  code: string;
  name: string;
  value: number | null;
  originalValue: number | null;
  rawValue?: string | number | null;
  needsConfirmation: boolean;
  confirmed: boolean;
  
  // Fields for Excel
  confidence?: number;
  matchedFrom?: string;
  
  // Fields for OCR
  isOcr?: boolean;
  ocrWarning?: string;
  isNullCode?: boolean;
  sourcePage?: number | null;
  sourceRegion?: string | null;
  extractor?: string;
  extractorVersion?: string;
  evidenceFlags?: string[];
  correctionReason: string;
}

export default function UploadReport({ onDataExtracted, onCancel }: UploadReportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Normalized indicators state for review grid
  const [reviewRows, setReviewRows] = useState<ExtractionRow[] | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<Record<string, string | null> | null>(null);
  const [previewChecksum, setPreviewChecksum] = useState<string | null>(null);
  const [previewExtractorVersions, setPreviewExtractorVersions] = useState<string[]>([]);
  const [previewReviewToken, setPreviewReviewToken] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearSelectedFile = (preserveError = false) => {
    setFile(null);
    if (!preserveError) setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const getApiErrorMessage = async (response: Response, fallback: string) => {
    try {
      const payload = await response.json();
      const detail = payload?.detail ?? payload?.error ?? payload?.message;
      if (typeof detail === "string" && detail.trim()) return detail;
      if (Array.isArray(detail)) {
        const messages = detail
          .map((item: unknown) => typeof item === "string" ? item : (item as { msg?: unknown })?.msg)
          .filter((item: unknown): item is string => typeof item === "string" && Boolean(item.trim()));
        if (messages.length) return messages.join("; ");
      }
    } catch {
      // Some reverse proxies return an HTML/plain-text error page.
    }
    return fallback;
  };

  const INDICATOR_MAP: Record<string, string> = {
    CT01: "Tổng số hộ dân (Hộ)",
    CT02: "Tổng số nhân khẩu (Nhân khẩu)",
    CT03: "Số hộ nghèo (Hộ)",
    CT04: "Số hộ cận nghèo (Hộ)",
    CT05: "Số người có công với cách mạng đang được quản lý (Người)",
    CT06: "Số đối tượng bảo trợ xã hội đang hưởng trợ cấp (Người)",
    CT07: "Số trẻ em dưới 16 tuổi (Trẻ em)",
    CT08: "Số trẻ em có hoàn cảnh đặc biệt (Trẻ em)",
    CT09: "Số hộ đạt 'Gia đình văn hóa' (Hộ)",
    CT10: "Số người trong độ tuổi lao động (Người)",
    CT11: "Số người tham gia BHYT (Người)",
    CT12: "Số thành viên Tổ công nghệ số cộng đồng (Người)",
    CT13: "Số người được hướng dẫn sử dụng dịch vụ công trực tuyến trong kỳ (Người)",
    CT14: "Số vụ bạo lực gia đình ghi nhận trong kỳ (Vụ)"
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setError(null);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (selectedFile: File) => {
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    const isExcel = ["xlsx"].includes(extension || "");

    if (!isExcel) {
      setError("Chỉ nhận biểu mẫu Excel (.xlsx). Nhận dạng ảnh/PDF đang khóa để bảo vệ dữ liệu cá nhân.");
      clearSelectedFile(true);
      return;
    }

    if (selectedFile.size === 0) {
      clearSelectedFile(true);
      setError("Tệp đang rỗng. Vui lòng chọn tệp có dữ liệu rồi thử lại.");
      return;
    }

    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      clearSelectedFile(true);
      setError("Tệp vượt quá giới hạn 5 MB. Vui lòng chọn tệp nhỏ hơn.");
      return;
    }

    setFile(selectedFile);

    uploadExcelFile(selectedFile);
  };

  // Excel mapping upload API call
  const uploadExcelFile = async (excelFile: File) => {
    setIsProcessing(true);
    setUploadProgress(0);
    setError(null);
    const formData = new FormData();
    formData.append("file", excelFile);

    try {
      const response = await apiUpload(
        "/reports/excel-preview",
        formData,
        setUploadProgress,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Không thể phân tích dữ liệu tệp Excel."));
      }

      const resData = await response.json();
      initializePreview(
        resData.values || {},
        resData.raw_values || {},
        resData.flags || [],
        resData.null_codes || [],
        "excel",
        resData.metadata || null,
        resData.evidence || {},
        typeof resData.checksum_sha256 === "string" ? resData.checksum_sha256 : null,
        Array.isArray(resData.extractor_versions) ? resData.extractor_versions : [],
        typeof resData.extraction_review_token === "string" ? resData.extraction_review_token : null,
      );
    } catch (err) {
      console.error(err);
      setError(toUserFacingError(err, "Đã xảy ra lỗi khi kết nối máy chủ chuẩn hóa biểu mẫu."));
    } finally {
      setIsProcessing(false);
      setUploadProgress(null);
    }
  };

  const initializeReview = (normalizedData: any) => {
    const rows: ExtractionRow[] = Object.keys(INDICATOR_MAP).map(code => {
      const apiItem = normalizedData?.[code] || {};
      const val = typeof apiItem.value === "number" ? apiItem.value : null;
      const conf = typeof apiItem.confidence === "number" ? apiItem.confidence : 0;
      const matched = apiItem.matched_from || "Không tìm thấy trong tệp";
      const needsConf = apiItem.needs_confirmation !== undefined ? apiItem.needs_confirmation : (conf < 0.85);

      return {
        code,
        name: INDICATOR_MAP[code],
        value: val,
        originalValue: val,
        confidence: conf,
        matchedFrom: matched,
        needsConfirmation: needsConf,
        confirmed: !needsConf,
        correctionReason: "",
      };
    });
    setReviewRows(rows);
  };

  const initializePreview = (
    values: Record<string, number | null>,
    rawValues: Record<string, string | number | null>,
    flags: Array<{ ct_code: string; error_type: string; message: string }>,
    nullCodes: string[],
    source: PreviewSource,
    metadata: Record<string, string | null> | null,
    evidence: Record<string, FieldEvidence>,
    checksum: string | null,
    extractorVersions: string[],
    reviewToken: string | null,
  ) => {
    const rows: ExtractionRow[] = Object.keys(INDICATOR_MAP).map(code => {
      const val = values[code] !== undefined ? values[code] : null;
      const flag = flags.find(f => f.ct_code === code);
      const isNull = nullCodes.includes(code);
      const fieldEvidence = evidence[code] || {};
      const needsConf = Boolean(fieldEvidence.requires_review) || !!flag || isNull || val === null;

      return {
        code,
        name: INDICATOR_MAP[code],
        value: val,
        originalValue: val,
        rawValue: fieldEvidence.raw_value ?? rawValues[code] ?? null,
        needsConfirmation: needsConf,
        confirmed: source === "excel" ? !needsConf : false,
        isOcr: source !== "excel",
        ocrWarning: flag ? flag.message : undefined,
        isNullCode: isNull,
        confidence: typeof fieldEvidence.confidence === "number" ? fieldEvidence.confidence : undefined,
        sourcePage: fieldEvidence.source_page,
        sourceRegion: fieldEvidence.source_region,
        extractor: fieldEvidence.extractor,
        extractorVersion: fieldEvidence.version,
        evidenceFlags: fieldEvidence.flags || [],
        correctionReason: "",
      };
    });
    setPreviewSource(source);
    setPreviewMetadata(metadata);
    setPreviewChecksum(checksum);
    setPreviewExtractorVersions(extractorVersions);
    setPreviewReviewToken(reviewToken);
    setReviewRows(rows);
  };

  const handleValueChange = (code: string, valStr: string) => {
    if (!reviewRows) return;
    if (!previewReviewToken) {
      setError("Bằng chứng rà soát đã thiếu hoặc hết hạn. Vui lòng xem trước lại tệp.");
      return;
    }
    const cleanVal = valStr === "" ? null : parseInt(valStr);
    
    setReviewRows(prev => {
      if (!prev) return null;
      return prev.map(row => {
        if (row.code === code) {
          const changed = row.originalValue !== cleanVal;
          return {
            ...row, 
            value: cleanVal,
            confirmed: changed ? false : row.confirmed,
          };
        }
        return row;
      });
    });
  };

  const handleReasonChange = (code: string, correctionReason: string) => {
    setReviewRows((previous) => previous?.map((row) => (
      row.code === code ? { ...row, correctionReason, confirmed: false } : row
    )) ?? null);
  };

  const handleToggleConfirm = (code: string) => {
    if (!reviewRows) return;
    setReviewRows(prev => {
      if (!prev) return null;
      return prev.map(row => {
        if (row.code === code) {
          if (row.value === null) return row;
          const changed = row.originalValue !== row.value;
          if (changed && row.correctionReason.trim().length < 3) {
            setError(`Vui lòng ghi lý do điều chỉnh ${row.code} trước khi xác nhận.`);
            return row;
          }
          setError(null);
          return { ...row, confirmed: !row.confirmed };
        }
        return row;
      });
    });
  };

  const handleConfirmNormalRows = () => {
    if (!reviewRows) return;
    setReviewRows(prev => {
      if (!prev) return null;
      return prev.map(row => {
        if (row.isOcr && !row.needsConfirmation && row.originalValue === row.value) {
          return { ...row, confirmed: true };
        }
        return row;
      });
    });
  };

  const handleApplyData = () => {
    if (!reviewRows) return;
    if (!previewReviewToken) {
      setError("Bằng chứng rà soát đã thiếu hoặc hết hạn. Vui lòng xem trước lại tệp.");
      return;
    }
    if (unconfirmedCount > 0) {
      alert('Vui lòng xác nhận tất cả các dòng trước khi lưu.');
      return; // Prevent submission if any row is unconfirmed
    }

    // Build finalized key-value pair of indicators to return to parent
    if (reviewRows.some(row => row.value === null)) {
      setError("Không thể áp dụng khi còn chỉ tiêu trống. Vui lòng nhập đủ CT01–CT14.");
      return;
    }

    const finalizedData: Record<string, number | null> = {};
    reviewRows.forEach(row => {
      finalizedData[row.code] = row.value;
    });

    const corrections: ExtractionCorrection[] = reviewRows
      .filter((row) => row.originalValue !== row.value)
      .map((row) => ({
        code: row.code as IndicatorCode,
        before: row.originalValue,
        after: row.value as number,
        reason: row.correctionReason.trim(),
      }));
    if (corrections.some((correction) => correction.reason.length < 3)) {
      setError("Mọi số liệu đã điều chỉnh phải có lý do trước khi áp dụng.");
      return;
    }

    const raw_source = previewSource === "excel" ? "excel_upload" : "photo_upload";

    onDataExtracted(finalizedData, {
      raw_source,
      source_confirmed: true,
      extraction_corrections: corrections,
      extraction_metadata: previewChecksum && previewSource ? {
        source_checksum: previewChecksum,
        source_type: previewSource,
        extractor_versions: previewExtractorVersions,
        field_count: reviewRows.length,
        requires_review_count: reviewRows.filter((row) => row.needsConfirmation).length,
      } : undefined,
      extraction_review_token: previewReviewToken,
    });
  };

  const handleReset = () => {
    setFile(null);
    setReviewRows(null);
    setError(null);
    setPreviewSource(null);
    setPreviewMetadata(null);
    setPreviewChecksum(null);
    setPreviewExtractorVersions([]);
    setPreviewReviewToken(null);
  };

  // Counting unconfirmed low confidence indicators
  const unconfirmedCount = reviewRows 
    ? reviewRows.filter(r => !r.confirmed).length 
    : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 md:p-6 space-y-6 shadow-xs font-sans">
      
      {/* Title & Metadata */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="space-y-1">
          <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Sparkles className="w-5.5 h-5.5 text-emerald-700" />
            <span>Nhập số liệu từ tệp Excel</span>
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Đọc biểu mẫu Excel; cán bộ luôn rà soát và xác nhận trước khi điền vào báo cáo.
          </p>
        </div>
        {reviewRows && (
          <button
            type="button"
            onClick={handleReset}
            className="min-h-11 text-xs font-bold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            Nạp lại tệp khác
          </button>
        )}
      </div>

      {/* Main Container Layout */}
      {!reviewRows ? (
        <div className="space-y-5">
          {/* Normal Drag & Drop Zone */}
          <div
              aria-busy={isProcessing}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer relative ${
                dragActive
                  ? "border-emerald-700 bg-emerald-50/40"
                  : "border-slate-250 hover:border-emerald-500 bg-slate-50/50"
              }`}
            >
              <label htmlFor="file-upload-input" className="block cursor-pointer rounded-xl focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-emerald-700">
                <input
                  type="file"
                  ref={fileInputRef}
                  id="file-upload-input"
                  accept=".xlsx"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={isProcessing}
                />
                {isProcessing ? (
                  <div className="flex flex-col items-center justify-center space-y-3 py-6">
                    <Loader2 className="w-10 h-10 text-emerald-800 animate-spin" />
                    <span className="text-sm font-extrabold text-emerald-900">
                      {uploadProgress !== null && uploadProgress < 100
                        ? `Đang tải tệp: ${uploadProgress}%`
                        : "Đang kiểm tra tệp và trích xuất số liệu…"}
                    </span>
                    {uploadProgress !== null && (
                      <div
                        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-emerald-100"
                        role="progressbar"
                        aria-label="Tiến độ tải tệp"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadProgress}
                      >
                        <div
                          className="h-full bg-emerald-700 transition-[width]"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    )}
                    <span className="text-xs text-slate-500 animate-pulse">
                      Thời gian xử lý phụ thuộc dung lượng và cấu trúc biểu mẫu
                    </span>
                  </div>
                ) : (
                  <div className="space-y-4 py-3">
                    <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-800 shadow-xs">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-black text-slate-800">
                        Kéo thả tệp báo cáo của thôn hoặc <span className="text-emerald-800 underline">Bấm để duyệt tệp</span>
                      </p>
                      <p className="text-2xs text-slate-400">
                        Excel theo biểu mẫu <b className="font-mono text-emerald-900">.xlsx</b>; tối đa 5 MB
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-center items-center gap-3 text-xs font-bold pt-2">
                      <span className="flex items-center gap-1 text-emerald-900 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        Excel theo biểu mẫu
                      </span>
                    </div>
                  </div>
                )}
              </label>
            </div>

          {file && !isProcessing && !reviewRows && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-2 text-emerald-950">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  <strong>Đã chọn tệp:</strong> {file.name} ({formatFileSize(file.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={clearSelectedFile}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
                aria-label="Bỏ tệp đã chọn"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Bỏ tệp
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 text-rose-800 rounded-xl flex items-start gap-2.5 text-xs font-bold leading-relaxed animate-fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
              <div>
                <p className="font-extrabold">Không đọc được tệp</p>
                <p className="font-medium text-rose-700 mt-0.5">{error}</p>
                {file && (
                  <button
                    type="button"
                    onClick={() => uploadExcelFile(file)}
                    className="mt-3 min-h-11 rounded-lg border border-rose-300 bg-white px-3 font-bold text-rose-800 hover:bg-rose-100"
                  >
                    Thử tải lại
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Interactive Mapping and Confirmation Review Grid */
        <div className="space-y-5 animate-fade-in">
          <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
            <div className="space-y-0.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Kết quả trích xuất — chờ cán bộ xác nhận</span>
              </h4>
              <p className="text-4xs text-slate-300">
                Tệp tin: <b className="font-mono text-white">{file?.name}</b> ({(file ? (file.size / 1024).toFixed(1) : 0)} KB)
              </p>
            </div>
            {unconfirmedCount > 0 ? (
              <span className="px-3 py-1.5 bg-amber-950 text-amber-400 font-extrabold text-2xs rounded-lg border border-amber-800 flex items-center gap-1 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Còn {unconfirmedCount} chỉ tiêu cần cán bộ rà soát</span>
              </span>
            ) : (
              <span className="px-3 py-1.5 bg-emerald-950 text-emerald-400 font-extrabold text-2xs rounded-lg border border-emerald-800 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>Tất cả chỉ tiêu đã được cán bộ xác nhận</span>
              </span>
            )}
          </div>

          {previewSource === "excel" && previewMetadata && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
              <p><span className="font-semibold">Thôn trong tệp:</span> {previewMetadata.village_name || "Chưa có"}</p>
              <p><span className="font-semibold">Kỳ báo cáo:</span> {previewMetadata.period_name || "Chưa có"}</p>
              <p><span className="font-semibold">Hạn nộp:</span> {previewMetadata.deadline || "Chưa có"}</p>
              <p><span className="font-semibold">Người lập:</span> {previewMetadata.reporter_name || "Chưa có"}</p>
              <p><span className="font-semibold">Chức danh:</span> {previewMetadata.reporter_title || "Chưa có"}</p>
              <p><span className="font-semibold">Số điện thoại:</span> {previewMetadata.reporter_phone || "Chưa có"}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-2xs text-slate-600">
            <span><b>Loại nguồn:</b> {previewSource === "excel" ? "Excel theo biểu mẫu" : previewSource === "pdf_ocr" ? "PDF quét" : "Ảnh báo cáo"}</span>
            <span><b>Mã kiểm tra tệp:</b> {previewChecksum ? `${previewChecksum.slice(0, 12)}…` : "Chưa có"}</span>
            <span><b>Bộ trích xuất:</b> {previewExtractorVersions.length ? previewExtractorVersions.join(", ") : "Chưa ghi nhận"}</span>
          </div>

          {/* Warning banner */}
          <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5 text-emerald-900 text-2xs font-medium leading-relaxed flex flex-col md:flex-row md:items-center justify-between gap-3">
            <span>
              <b>Hướng dẫn rà soát:</b> Đối chiếu số liệu với tài liệu gốc và xem vị trí nguồn. Nếu sửa giá trị, hãy ghi lý do rồi bấm dấu tích để xác nhận. Quy tắc nghiệp vụ của hệ thống vẫn là căn cứ chặn dữ liệu không hợp lệ.
            </span>
            {reviewRows.some(r => r.isOcr && !r.needsConfirmation && !r.confirmed && r.originalValue === r.value) && (
              <button
                type="button"
                onClick={handleConfirmNormalRows}
                className="px-3 py-2 text-2xs font-extrabold text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg hover:bg-emerald-200 active:scale-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <CheckSquare className="w-4 h-4" />
                Xác nhận các dòng không có cảnh báo
              </button>
            )}
          </div>

          {/* Table Container */}
          <div className="border border-slate-150 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-3xs font-extrabold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4 w-[12%]">Mã CT</th>
                    <th className="py-3 px-4 w-[35%]">Tên chỉ tiêu (Đơn vị tính)</th>
                    {reviewRows.some(r => r.isOcr) ? (
                      <th className="py-3 px-4 w-[38%]">Bằng chứng và cảnh báo</th>
                    ) : (
                      <>
                        <th className="py-3 px-4 w-[25%]">Dữ liệu gốc tìm thấy</th>
                        <th className="py-3 px-4 w-[13%] text-center">Độ tin cậy</th>
                      </>
                    )}
                    <th className="py-3 px-4 w-[15%] text-right">Số liệu trích xuất</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {reviewRows.map((row) => {
                    const isLowConf = row.needsConfirmation;
                    const confPercentage = row.confidence !== undefined ? Math.round(row.confidence * 100) : 0;
                    const isChanged = row.originalValue !== row.value;

                    // Choose colors based on confidence
                    let badgeClass = "bg-slate-100 text-slate-600";
                    if (row.confidence !== undefined) {
                      if (row.confidence >= 0.85) {
                        badgeClass = "bg-emerald-50 text-emerald-800 border border-emerald-100";
                      } else if (row.confidence >= 0.5) {
                        badgeClass = "bg-amber-50 text-amber-800 border border-amber-100";
                      } else if (row.confidence > 0) {
                        badgeClass = "bg-rose-50 text-rose-800 border border-rose-100";
                      }
                    }

                    return (
                      <tr 
                        key={row.code}
                        className={`transition-colors hover:bg-slate-50/50 ${
                          isLowConf && !row.confirmed
                            ? "bg-amber-50/30 font-bold"
                            : ""
                        }`}
                      >
                        {/* 1. Code */}
                        <td className="py-3 px-4 font-mono font-bold text-slate-600 text-2xs">
                          <span className={`px-1.5 py-0.5 rounded ${
                            isLowConf && !row.confirmed
                              ? "bg-amber-100 text-amber-900 border border-amber-200"
                              : "bg-slate-100 text-slate-700"
                          }`}>
                            {row.code}
                          </span>
                        </td>

                        {/* 2. Name */}
                        <td className="py-3 px-4 font-bold text-slate-800">
                          <div className="flex flex-col">
                            <span>{row.name}</span>
                            {isLowConf && !row.confirmed && (
                              <span className="text-4xs text-amber-800 font-extrabold flex items-center gap-0.5 mt-0.5">
                                <AlertTriangle className="w-3 h-3 text-amber-700" />
                                Rà soát bắt buộc
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Matched From Original Text OR OCR Warning */}
                        {row.isOcr ? (
                          <td className="py-3 px-4">
                            <div className="space-y-1.5 text-2xs">
                              <div className="flex flex-wrap items-center gap-2 text-slate-600">
                                <span><b>Giá trị gốc:</b> {row.rawValue === null || row.rawValue === undefined ? "—" : String(row.rawValue)}</span>
                                {row.confidence !== undefined && <span className={`rounded-full px-2 py-0.5 font-black ${badgeClass}`}>Tin cậy {confPercentage}%</span>}
                              </div>
                              <p className="text-slate-500">
                                <b>Vị trí:</b> {row.sourcePage ? `trang ${row.sourcePage}` : "tệp hiện tại"}{row.sourceRegion ? ` · ${row.sourceRegion}` : ""}
                              </p>
                              {(row.extractor || row.extractorVersion) && <p className="text-slate-400">Bộ trích xuất: {row.extractor || "OCR"}{row.extractorVersion ? ` · ${row.extractorVersion}` : ""}</p>}
                              {row.isNullCode ? (
                                <span className="font-extrabold text-rose-700 bg-rose-50 px-2.5 py-1.5 rounded border border-rose-200 block">Không đọc được số liệu; cần nhập từ tài liệu gốc.</span>
                              ) : row.ocrWarning ? (
                                <span className="font-bold text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded border border-amber-200 block">{row.ocrWarning}</span>
                              ) : row.evidenceFlags?.length ? (
                                <span className="font-bold text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded border border-amber-200 block">{row.evidenceFlags.join(" · ")}</span>
                              ) : (
                                <span className="text-slate-500">Không có cảnh báo theo quy tắc.</span>
                              )}
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="py-3 px-4 text-slate-500 italic max-w-[200px] truncate" title={row.matchedFrom}>
                              <span className="text-2xs font-medium">{row.rawValue === null || row.rawValue === undefined ? "—" : String(row.rawValue)}</span>
                              {row.sourceRegion && <span className="mt-1 block text-4xs not-italic text-slate-400">Nguồn: {row.sourceRegion}</span>}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex flex-col items-center justify-center">
                                <span className={`text-4xs font-black px-2 py-0.5 rounded-full ${badgeClass}`}>
                                  {confPercentage}%
                                </span>
                              </div>
                            </td>
                          </>
                        )}

                        {/* 5. Editable Numeric Value & Tick Box */}
                        <td className="py-3 px-4">
                          <div className="flex items-start justify-end gap-2">
                            {/* Input number */}
                            <input
                              type="number"
                              min="0"
                              value={row.value === null ? "" : row.value}
                              aria-label={`Giá trị ${row.code} · ${row.name}`}
                              onChange={(e) => handleValueChange(row.code, e.target.value)}
                              placeholder="0"
                              onKeyDown={(e) => {
                                // Block alphabetic entries and symbols
                                if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-" || e.key === ".") {
                                  e.preventDefault();
                                }
                              }}
                              className={`w-20 bg-white border rounded-lg py-1.5 px-2.5 text-right font-black text-sm text-slate-800 focus:outline-hidden focus:ring-1 ${
                                isLowConf && !row.confirmed
                                  ? "border-amber-400 focus:ring-amber-500 text-amber-950 bg-amber-50/25"
                                  : "border-slate-200 focus:ring-emerald-600"
                              }`}
                            />

                            {/* Confirmation Tickbox */}
                            <button
                              type="button"
                              onClick={() => handleToggleConfirm(row.code)}
                              aria-label={`${row.confirmed ? "Bỏ xác nhận" : "Xác nhận"} ${row.code} · ${row.name}`}
                              aria-pressed={row.confirmed}
                              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                                row.confirmed
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                                  : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              }`}
                              title={row.confirmed ? "Đã xác nhận" : "Cần bấm xác nhận chỉ tiêu"}
                            >
                              <Check className={`w-4 h-4 transition-transform ${row.confirmed ? "scale-110 font-bold" : "scale-90"}`} />
                            </button>
                          </div>
                          {isChanged && (
                            <label className="mt-2 block text-4xs font-bold text-slate-600">
                              Lý do điều chỉnh
                              <input
                                type="text"
                                value={row.correctionReason}
                                onChange={(event) => handleReasonChange(row.code, event.target.value)}
                                minLength={3}
                                maxLength={240}
                                required
                                className="mt-1 w-full min-w-40 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-2xs font-medium text-slate-800"
                                placeholder="Đối chiếu tài liệu gốc…"
                              />
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleReset}
              className="px-5 py-3 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 active:scale-98 transition-all cursor-pointer"
            >
              Hủy kết quả và chọn lại
            </button>
            <button
              type="button"
              onClick={handleApplyData}
              disabled={unconfirmedCount > 0}
              className={`px-6 py-3 text-xs font-black rounded-xl active:scale-98 transition-all flex items-center gap-2 cursor-pointer shadow-xs ${
                unconfirmedCount > 0
                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                  : "bg-emerald-800 hover:bg-emerald-900 text-white"
              }`}
            >
              <CheckCircle2 className="w-4.5 h-4.5" />
              <span>Xác nhận và điền vào biểu mẫu</span>
            </button>
          </div>
          
          {unconfirmedCount > 0 && (
            <p className="text-right text-4xs text-amber-800 font-extrabold animate-pulse">
              Vui lòng xác nhận từng chỉ tiêu; nếu điều chỉnh số liệu, cần ghi rõ lý do.
            </p>
          )}
        </div>
      )}

    </div>
  );
}
