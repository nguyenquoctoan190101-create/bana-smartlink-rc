import React, { useState, useRef } from "react";
import { 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Upload, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle,
  Loader2, 
  Check, 
  CheckSquare,
  X, 
  ShieldAlert
} from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";

interface UploadReportProps {
  onDataExtracted: (
    indicators: Record<string, number | null>,
    metadata?: { raw_source: string; source_confirmed: boolean }
  ) => void;
  onCancel: () => void;
}

interface ExtractionRow {
  code: string;
  name: string;
  value: number | null;
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
}

export default function UploadReport({ onDataExtracted, onCancel }: UploadReportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Privacy warning step for image upload
  const [showPrivacyWarning, setShowPrivacyWarning] = useState<boolean>(false);
  
  // Normalized indicators state for review grid
  const [reviewRows, setReviewRows] = useState<ExtractionRow[] | null>(null);
  const [previewSource, setPreviewSource] = useState<"excel" | "photo_ocr" | null>(null);
  const [previewMetadata, setPreviewMetadata] = useState<Record<string, string | null> | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearSelectedFile = (preserveError = false) => {
    setFile(null);
    setShowPrivacyWarning(false);
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
    CT13: "Số người dân được hướng dẫn dùng DVC trực tuyến trong kỳ (Lượt)",
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
    const isImage = ["png", "jpg", "jpeg"].includes(extension || "");
    const isExcel = ["xlsx"].includes(extension || "");

    if (!isImage && !isExcel) {
      setError("Định dạng tệp không được hỗ trợ. Vui lòng chỉ tải lên file Excel (.xlsx) hoặc tệp ảnh (.png, .jpg, .jpeg)");
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

    if (isImage) {
      // Prompt privacy warning before doing anything
      setShowPrivacyWarning(true);
    } else {
      // Excel file - start uploading directly
      uploadExcelFile(selectedFile);
    }
  };

  const handleAcknowledgePrivacy = () => {
    setShowPrivacyWarning(false);
    if (file) {
      uploadImageFile(file);
    }
  };

  // 1. Image Digitization upload API call
  const uploadImageFile = async (imgFile: File) => {
    setIsProcessing(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", imgFile);

    try {
      const response = await apiFetch("/reports/ocr-preview", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Không thể số hóa hình ảnh."));
      }

      const resData = await response.json();
      initializePreview(
        resData.values || {},
        resData.raw_values || resData.values || {},
        resData.flags || [],
        resData.null_codes || [],
        "photo_ocr",
        null,
      );
    } catch (err) {
      console.error(err);
      setError(toUserFacingError(err, "Đã xảy ra lỗi khi kết nối máy chủ phân tích ảnh."));
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Excel mapping upload API call
  const uploadExcelFile = async (excelFile: File) => {
    setIsProcessing(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", excelFile);

    try {
      const response = await apiFetch("/reports/excel-preview", {
        method: "POST",
        body: formData,
      });

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
      );
    } catch (err) {
      console.error(err);
      setError(toUserFacingError(err, "Đã xảy ra lỗi khi kết nối máy chủ chuẩn hóa biểu mẫu."));
    } finally {
      setIsProcessing(false);
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
        confidence: conf,
        matchedFrom: matched,
        needsConfirmation: needsConf,
        confirmed: !needsConf
      };
    });
    setReviewRows(rows);
  };

  const initializePreview = (
    values: Record<string, number | null>,
    rawValues: Record<string, string | number | null>,
    flags: Array<{ ct_code: string; error_type: string; message: string }>,
    nullCodes: string[],
    source: "excel" | "photo_ocr",
    metadata: Record<string, string | null> | null,
  ) => {
    const rows: ExtractionRow[] = Object.keys(INDICATOR_MAP).map(code => {
      const val = values[code] !== undefined ? values[code] : null;
      const flag = flags.find(f => f.ct_code === code);
      const isNull = nullCodes.includes(code);
      const needsConf = !!flag || isNull || val === null;

      return {
        code,
        name: INDICATOR_MAP[code],
        value: val,
        rawValue: rawValues[code] ?? null,
        needsConfirmation: needsConf,
        confirmed: source === "excel" ? !needsConf : false,
        isOcr: source === "photo_ocr",
        ocrWarning: flag ? flag.message : undefined,
        isNullCode: isNull
      };
    });
    setPreviewSource(source);
    setPreviewMetadata(metadata);
    setReviewRows(rows);
  };

  const handleValueChange = (code: string, valStr: string) => {
    if (!reviewRows) return;
    const cleanVal = valStr === "" ? null : parseInt(valStr);
    
    setReviewRows(prev => {
      if (!prev) return null;
      return prev.map(row => {
        if (row.code === code) {
          return { 
            ...row, 
            value: cleanVal,
            // Editing the value automatically confirms the correctness of this row
            confirmed: true 
          };
        }
        return row;
      });
    });
  };

  const handleToggleConfirm = (code: string) => {
    if (!reviewRows) return;
    setReviewRows(prev => {
      if (!prev) return null;
      return prev.map(row => {
        if (row.code === code) {
          if (row.value === null) return row;
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
        if (row.isOcr && !row.needsConfirmation) {
          return { ...row, confirmed: true };
        }
        return row;
      });
    });
  };

  const handleApplyData = () => {
    if (!reviewRows) return;
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

    const raw_source = previewSource === "photo_ocr" ? "photo_upload" : "excel_upload";

    onDataExtracted(finalizedData, {
      raw_source,
      source_confirmed: true
    });
  };

  const handleReset = () => {
    setFile(null);
    setReviewRows(null);
    setError(null);
    setShowPrivacyWarning(false);
    setPreviewSource(null);
    setPreviewMetadata(null);
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
            <span>Nạp báo cáo bằng Tệp tin & Trí tuệ nhân tạo (AI)</span>
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Hỗ trợ nạp biểu mẫu Excel thôn hoặc tự động số hóa ảnh báo cáo giấy viết tay qua Gemini AI đa phương thức.
          </p>
        </div>
        {reviewRows && (
          <button
            onClick={handleReset}
            className="text-xs font-bold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            Nạp lại tệp khác
          </button>
        )}
      </div>

      {/* Main Container Layout */}
      {!reviewRows ? (
        <div className="space-y-5">
          {/* Privacy Warning Modal overlay/alert if an image was dropped/selected */}
          {showPrivacyWarning && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4 animate-fade-in shadow-xs">
              <div className="flex items-start gap-3">
                <div className="bg-amber-100 p-2 rounded-lg text-amber-800 shrink-0">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-black text-amber-900 leading-tight uppercase tracking-wide">
                    Quy định bảo mật thông tin cá nhân
                  </h4>
                  <p className="text-xs font-bold text-amber-850 leading-relaxed">
                    "Ảnh sẽ được AI đọc số liệu — vui lòng che hoặc không chụp phần tên/SĐT người lập nếu có thể"
                  </p>
                  <p className="text-2xs text-amber-700 leading-relaxed">
                    Để tuân thủ nghị định bảo vệ dữ liệu cá nhân, hệ thống khuyên dùng biện pháp che mờ vật lý phần chữ ký hoặc thông tin liên hệ nhạy cảm ở góc tờ báo cáo trước khi chụp ảnh.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-amber-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowPrivacyWarning(false);
                    clearSelectedFile();
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 active:scale-98 transition-all cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleAcknowledgePrivacy}
                  className="px-4 py-2 text-xs font-black text-white bg-amber-800 hover:bg-amber-950 rounded-xl active:scale-98 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-4 h-4" />
                  <span>Đồng ý & Bắt đầu phân tích ảnh</span>
                </button>
              </div>
            </div>
          )}

          {/* Normal Drag & Drop Zone */}
          {!showPrivacyWarning && (
            <div
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
              <input
                type="file"
                ref={fileInputRef}
                id="file-upload-input"
                accept=".xlsx, .png, .jpg, .jpeg"
                className="hidden"
                onChange={handleFileChange}
                disabled={isProcessing}
              />
              <label htmlFor="file-upload-input" className="cursor-pointer block">
                {isProcessing ? (
                  <div className="flex flex-col items-center justify-center space-y-3 py-6">
                    <Loader2 className="w-10 h-10 text-emerald-800 animate-spin" />
                    <span className="text-sm font-extrabold text-emerald-900">
                      Hệ thống đang chuẩn hóa biểu mẫu và số hóa qua AI...
                    </span>
                    <span className="text-xs text-slate-500 animate-pulse">
                      Quá trình phân tích Fuzzy Match & Trích xuất OCR có thể mất 3-5 giây
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
                        Chấp nhận định dạng Excel (<b className="font-mono text-emerald-900">.xlsx</b>) hoặc ảnh chụp phiếu báo cáo giấy (<b className="font-mono text-emerald-900">.png, .jpg, .jpeg</b>)
                      </p>
                    </div>

                    <div className="flex justify-center items-center gap-4 text-xs font-bold pt-2">
                      <span className="flex items-center gap-1 text-emerald-900 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        Excel Chuẩn hóa Fuzzy Match
                      </span>
                      <span className="flex items-center gap-1 text-sky-900 bg-sky-50 px-2.5 py-1 rounded-md border border-sky-100">
                        <ImageIcon className="w-4 h-4 text-sky-700" />
                        Hình ảnh Số hóa Gemini AI
                      </span>
                    </div>
                  </div>
                )}
              </label>
            </div>
          )}

          {file && !isProcessing && !showPrivacyWarning && !reviewRows && (
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
                <p className="font-extrabold">Xảy ra lỗi xử lý:</p>
                <p className="font-medium text-rose-700 mt-0.5">{error}</p>
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
                <span>Kết quả Số hóa / Ánh xạ Dữ liệu Thành Công</span>
              </h4>
              <p className="text-4xs text-slate-300">
                Tệp tin: <b className="font-mono text-white">{file?.name}</b> ({(file ? (file.size / 1024).toFixed(1) : 0)} KB)
              </p>
            </div>
            {unconfirmedCount > 0 ? (
              <span className="px-3 py-1.5 bg-amber-950 text-amber-400 font-extrabold text-2xs rounded-lg border border-amber-800 flex items-center gap-1 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Còn {unconfirmedCount} chỉ tiêu độ tin cậy thấp cần cán bộ rà soát</span>
              </span>
            ) : (
              <span className="px-3 py-1.5 bg-emerald-950 text-emerald-400 font-extrabold text-2xs rounded-lg border border-emerald-800 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>Tất cả chỉ tiêu đã được rà soát và xác nhận hợp lệ</span>
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

          {/* Warning banner */}
          <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3.5 text-emerald-900 text-2xs font-medium leading-relaxed flex flex-col md:flex-row md:items-center justify-between gap-3">
            <span>
              <b>💡 Hướng dẫn rà soát:</b> Vui lòng đối chiếu các giá trị số do AI đọc được. Bạn có thể <b>gõ sửa trực tiếp vào ô số</b> nếu phát hiện sai sót, việc chỉnh sửa sẽ tự động đánh dấu chỉ tiêu là "Đã xác nhận". Khi hoàn tất, bấm nút Áp dụng ở dưới cùng để nạp dữ liệu.
            </span>
            {reviewRows.some(r => r.isOcr && !r.needsConfirmation && !r.confirmed) && (
              <button
                type="button"
                onClick={handleConfirmNormalRows}
                className="px-3 py-2 text-2xs font-extrabold text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-lg hover:bg-emerald-200 active:scale-95 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <CheckSquare className="w-4 h-4" />
                Tích chọn nhanh các dòng Bình thường
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
                      <th className="py-3 px-4 w-[38%]">Cảnh báo nhận dạng</th>
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
                                Rà soát bắt buộc (Độ tin cậy thấp)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Matched From Original Text OR OCR Warning */}
                        {row.isOcr ? (
                          <td className="py-3 px-4">
                            {row.isNullCode ? (
                              <span className="text-2xs font-extrabold text-rose-700 bg-rose-50 px-2.5 py-1.5 rounded border border-rose-200 block">Không đọc được số liệu này, vui lòng nhập tay</span>
                            ) : row.ocrWarning ? (
                              <span className="text-2xs font-bold text-amber-800 bg-amber-50 px-2.5 py-1.5 rounded border border-amber-200 block">{row.ocrWarning}</span>
                            ) : (
                              <span className="text-2xs text-slate-400 italic">Bình thường</span>
                            )}
                          </td>
                        ) : (
                          <>
                            <td className="py-3 px-4 text-slate-500 italic max-w-[200px] truncate" title={row.matchedFrom}>
                              <span className="text-2xs font-medium">{row.rawValue === null || row.rawValue === undefined ? "—" : String(row.rawValue)}</span>
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
                          <div className="flex items-center justify-end gap-2">
                            {/* Input number */}
                            <input
                              type="number"
                              min="0"
                              value={row.value === null ? "" : row.value}
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
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                row.confirmed
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                                  : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              }`}
                              title={row.confirmed ? "Đã xác minh" : "Cần bấm xác minh chỉ tiêu"}
                            >
                              <Check className={`w-4 h-4 transition-transform ${row.confirmed ? "scale-110 font-bold" : "scale-90"}`} />
                            </button>
                          </div>
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
              Hủy kết quả & Chọn lại
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
              <span>XÁC NHẬN & ĐIỀN VÀO BIỂU MẪU</span>
            </button>
          </div>
          
          {unconfirmedCount > 0 && (
            <p className="text-right text-4xs text-amber-800 font-extrabold animate-pulse">
              * Vui lòng click xác nhận (Dấu tích xanh) hoặc điều chỉnh các chỉ tiêu có độ tin cậy thấp để mở khóa nút áp dụng.
            </p>
          )}
        </div>
      )}

    </div>
  );
}
