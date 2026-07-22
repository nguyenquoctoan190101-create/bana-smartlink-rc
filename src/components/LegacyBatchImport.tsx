import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileArchive, Upload } from "lucide-react";

import { apiJson, toUserFacingError } from "../lib/apiClient";
import { useReportPeriods } from "../lib/useReportPeriods";
import { Button, DataScope, ErrorState, PageHeader, SectionCard, StatusBadge } from "./ui";

type Flag = { ct_code: string; error_type: string; message: string };
type PreviewFile = {
  source_filename: string;
  content_sha256: string;
  source_village_name: string;
  mapping: {
    mapping_status: string;
    target_village_id: string | null;
    proposed_target_village_id: string | null;
    legacy_unit_type: "village" | "resettlement_area";
  };
  metadata: Record<string, string | null>;
  raw_values: Record<string, unknown>;
  normalized_values: Record<string, number | null>;
  validation_flags: Flag[];
  has_blocking_errors: boolean;
};
type Preview = {
  mapping_version: string;
  expected_village_count: number;
  uploaded_village_count: number;
  missing_villages: string[];
  unresolved_villages: string[];
  duplicate_villages: string[];
  files_with_blocking_errors: string[];
  ready_for_review: boolean;
  files: PreviewFile[];
};
type StoredFile = PreviewFile & { id: string; mapping_status: string; review_status: "pending" | "accepted" | "rejected" };
type TargetReadiness = {
  target_village_id: string;
  target_village_name: string;
  eligible: boolean;
  missing_sources: string[];
  rejected_sources: string[];
  pending_sources: string[];
  unresolved_sources: string[];
};
type BatchDetail = {
  batch: { id: string; status: string; mapping_version: string; period_id: string };
  files: StoredFile[];
  summary: {
    expected_village_count: number;
    uploaded_village_count: number;
    missing_village_count: number;
    missing_villages: string[];
    unresolved_villages: string[];
    pending_review_villages: string[];
    accepted_villages: string[];
    rejected_villages: string[];
    eligible_target_villages: TargetReadiness[];
    excluded_target_villages: TargetReadiness[];
    ready_to_commit: boolean;
  };
};

const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LegacyBatchImport() {
  const { periods, isLoading: periodsLoading } = useReportPeriods();
  const [periodId, setPeriodId] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [reasons, setReasons] = useState<Record<string, Record<string, string>>>({});
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [phoneReasons, setPhoneReasons] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPeriod = periods.find((period) => period.id === periodId);
  const blockers = useMemo(() => {
    if (!preview) return 0;
    return preview.missing_villages.length + preview.unresolved_villages.length + preview.duplicate_villages.length + preview.files_with_blocking_errors.length;
  }, [preview]);

  const formData = () => {
    const body = new FormData();
    selectedFiles.forEach((file) => body.append("files", file, file.name));
    return body;
  };

  const clearSelectedFiles = () => {
    setSelectedFiles([]);
    setPreview(null);
    fileInputRef.current && (fileInputRef.current.value = "");
  };

  const runPreview = async () => {
    if (!selectedFiles.length) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      setPreview(await apiJson<Preview>("/report-imports/preview", { method: "POST", body: formData() }));
    } catch (caught) {
      setError(toUserFacingError(caught, "Không thể kiểm tra bộ tệp."));
    } finally {
      setBusy(false);
    }
  };

  const refreshBatch = async (batchId: string) => {
    const next = await apiJson<BatchDetail>(`/report-imports/batches/${batchId}`);
    setDetail(next);
    setEdits(Object.fromEntries(next.files.map((file) => [file.id, Object.fromEntries(
      Object.entries(file.normalized_values).map(([code, value]) => [code, value === null ? "" : String(value)])
    )])));
    setPhones(Object.fromEntries(next.files.map((file) => [file.id, file.metadata.reporter_phone || ""])));
  };

  const createReviewBatch = async () => {
    if (!periodId || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await apiJson<{ id: string }>("/report-imports/batches", {
        method: "POST",
        body: JSON.stringify({ period_id: periodId, expected_village_count: preview.expected_village_count }),
      });
      await apiJson<StoredFile[]>(`/report-imports/batches/${batch.id}/files`, { method: "POST", body: formData() });
      await refreshBatch(batch.id);
    } catch (caught) {
      setError(toUserFacingError(caught, "Không thể tạo đợt kiểm duyệt."));
    } finally {
      setBusy(false);
    }
  };

  const reviewFile = async (file: StoredFile, decision: "accepted" | "rejected") => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const fileEdits: Record<string, string> = edits[file.id] ?? {};
      const values = Object.fromEntries(
        Object.entries(fileEdits).map(([code, value]) => [code, value.trim() === "" ? null : Number(value)])
      );
      await apiJson(`/report-imports/files/${file.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({
          decision,
          values,
          reasons: reasons[file.id] || {},
          reporter_phone: phones[file.id] || null,
          metadata_reason: phoneReasons[file.id] || null,
          decision_reason: decisionReasons[file.id] || null,
        }),
      });
      await refreshBatch(detail.batch.id);
    } catch (caught) {
      setError(toUserFacingError(caught, "Không thể lưu quyết định kiểm duyệt."));
    } finally {
      setBusy(false);
    }
  };

  const commitBatch = async () => {
    if (!detail || !window.confirm(
      `Xác nhận tạo ${detail.summary.eligible_target_villages.length} báo cáo đủ nguồn? ` +
      `${detail.summary.excluded_target_villages.length} thôn mới thiếu hoặc chưa rõ nguồn sẽ không được tổng hợp.`
    )) return;
    setBusy(true);
    setError(null);
    try {
      await apiJson(`/report-imports/batches/${detail.batch.id}/commit`, { method: "POST" });
      await refreshBatch(detail.batch.id);
    } catch (caught) {
      setError(toUserFacingError(caught, "Không thể chốt đợt nhập."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Quản trị dữ liệu"
        title="Nhập báo cáo 22 thôn cũ"
        description="Kiểm tra tệp, đối chiếu ánh xạ và xử lý từng cảnh báo trước khi tổng hợp sang 10 thôn mới. Đông Sơn luôn bị khóa đến khi có quyết định phạm vi chính thức."
      />
      {error && <ErrorState description={error} />}

      <SectionCard className="p-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 font-semibold text-sm">
            Kỳ báo cáo
            <select value={periodId} onChange={(event) => setPeriodId(event.target.value)} disabled={periodsLoading || Boolean(detail)}>
              <option value="">Chọn kỳ cần nhập</option>
              {periods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
            </select>
          </label>
          <label className="space-y-2 font-semibold text-sm">
            Bộ tệp XLSX (tối đa 25 tệp)
            <input
              ref={fileInputRef}
              type="file"
              accept={MIME + ",.xlsx"}
              multiple
              disabled={Boolean(detail)}
              onChange={(event) => {
                setSelectedFiles(Array.from(event.target.files || []));
                setPreview(null);
                setError(null);
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white p-2"
            />
            <div className="flex items-center justify-between gap-3" aria-live="polite">
              <span className="block text-xs font-normal text-slate-500">
                {selectedFiles.length
                  ? `Đã chọn ${selectedFiles.length} tệp XLSX.`
                  : "Chưa chọn tệp. Bạn có thể chọn tối đa 25 tệp XLSX."}
              </span>
              {selectedFiles.length > 0 && <Button type="button" variant="secondary" onClick={clearSelectedFiles} disabled={busy || Boolean(detail)} className="min-h-11">Bỏ tệp</Button>}
            </div>
          </label>
        </div>
        {selectedFiles.length > 0 && !detail && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3" aria-label="Danh sách tệp đã chọn">
            <p className="text-sm font-semibold text-emerald-900">Tệp đã chọn</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm text-emerald-900">
              {selectedFiles.map((file) => <li key={`${file.name}-${file.lastModified}`} className="flex flex-wrap justify-between gap-2"><span className="break-all">{file.name}</span><span className="text-emerald-700">{formatFileSize(file.size)}</span></li>)}
            </ul>
          </div>
        )}
        <DataScope period={selectedPeriod?.name} scope={`${selectedFiles.length} tệp đã chọn`} quality={preview ? `${blockers} mục cần xử lý` : "Chưa kiểm tra"} />
        <div className="flex flex-wrap gap-3">
          <Button onClick={runPreview} disabled={!selectedFiles.length || busy}><Upload />{busy ? "Đang kiểm tra…" : "Kiểm tra bộ tệp"}</Button>
          {preview && !detail && (
            <Button variant="secondary" onClick={createReviewBatch} disabled={!periodId || busy || !preview.ready_for_review}>
              <FileArchive />Tạo đợt kiểm duyệt
            </Button>
          )}
        </div>
      </SectionCard>

      {preview && !detail && (
        <SectionCard className="overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h2 className="font-bold text-lg">Kết quả đối chiếu trước khi lưu</h2>
            <p className="text-sm text-slate-600 mt-1">Phiên bản ánh xạ {preview.mapping_version} · {preview.uploaded_village_count}/{preview.expected_village_count} thôn có tệp.</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <div><strong>Chưa nộp</strong><p className="text-sm text-slate-600">{preview.missing_villages.join(", ") || "Không có"}</p></div>
            <div><strong>Ánh xạ bị khóa</strong><p className="text-sm text-slate-600">{preview.unresolved_villages.join(", ") || "Không có"}</p></div>
            <div><strong>Tệp có lỗi chặn</strong><p className="text-sm text-slate-600">{preview.files_with_blocking_errors.length} tệp</p></div>
          </div>
          <div className="overflow-x-auto"><table><thead><tr><th>Thôn cũ</th><th>Tệp</th><th>Ánh xạ</th><th>Kiểm tra</th></tr></thead><tbody>
            {preview.files.map((file) => <tr key={file.content_sha256}><td className="font-semibold">{file.source_village_name}</td><td>{file.source_filename}</td><td><StatusBadge status={file.mapping.mapping_status === "confirmed" ? "ready" : "blocked"} label={file.mapping.mapping_status === "confirmed" ? "Đã xác nhận" : "Chờ quyết định"} /></td><td><StatusBadge status={file.has_blocking_errors ? "blocked" : file.validation_flags.length ? "needs_review" : "ready"} label={`${file.validation_flags.length} cảnh báo`} /></td></tr>)}
          </tbody></table></div>
        </SectionCard>
      )}

      {detail && (
        <SectionCard className="overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-bold text-lg">Đợt kiểm duyệt {detail.batch.id.slice(0, 8)}</h2><p className="text-sm text-slate-600">{detail.summary.uploaded_village_count}/{detail.summary.expected_village_count} thôn · còn thiếu {detail.summary.missing_village_count} · đủ nguồn {detail.summary.eligible_target_villages.length}/10 thôn mới</p></div>
            <Button onClick={commitBatch} disabled={!detail.summary.ready_to_commit || busy}><CheckCircle2 />Chốt nhóm đủ nguồn</Button>
          </div>
          <div className="grid gap-4 border-b border-slate-200 bg-slate-50 p-5 lg:grid-cols-2">
            <div>
              <h3 className="font-bold text-emerald-800">Có thể tổng hợp</h3>
              <p className="mt-1 text-sm text-slate-700">{detail.summary.eligible_target_villages.map((item) => item.target_village_name).join(", ") || "Chưa có nhóm nào đủ toàn bộ nguồn."}</p>
            </div>
            <div>
              <h3 className="font-bold text-amber-800">Chưa được tổng hợp</h3>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {detail.summary.excluded_target_villages.map((item) => (
                  <li key={item.target_village_id}>
                    <strong>{item.target_village_name}:</strong>{" "}
                    {[...item.missing_sources, ...item.rejected_sources, ...item.pending_sources, ...item.unresolved_sources].join(", ") || "chưa đủ điều kiện"}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="divide-y divide-slate-200">
            {detail.files.map((file) => {
              const ctFlags = file.validation_flags.filter((flag) => /^CT/.test(flag.ct_code));
              const badPhone = file.validation_flags.some((flag) => flag.ct_code === "PHONE");
              const mappingBlocked = file.mapping_status !== "confirmed";
              return <article key={file.id} className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{file.source_village_name}</h3><p className="text-xs text-slate-500 break-all">SHA-256: {file.content_sha256}</p></div><StatusBadge status={file.review_status} /></div>
                {file.validation_flags.length > 0 && <ul className="space-y-1 text-sm text-amber-800">{file.validation_flags.map((flag, index) => <li key={`${flag.ct_code}-${index}`}><AlertTriangle className="inline h-4 w-4 mr-1" />{flag.ct_code}: {flag.message}</li>)}</ul>}
                {file.review_status === "pending" && !mappingBlocked && <>
                  {ctFlags.map((flag) => <div key={flag.ct_code} className="grid gap-3 md:grid-cols-2"><label className="text-sm font-semibold">Giá trị chấp nhận {flag.ct_code}<input type="number" min={0} value={edits[file.id]?.[flag.ct_code] || ""} onChange={(event) => setEdits((old) => ({ ...old, [file.id]: { ...old[file.id], [flag.ct_code]: event.target.value } }))} /></label><label className="text-sm font-semibold">Lý do xử lý<input type="text" value={reasons[file.id]?.[flag.ct_code] || ""} onChange={(event) => setReasons((old) => ({ ...old, [file.id]: { ...old[file.id], [flag.ct_code]: event.target.value } }))} placeholder="Nguồn đối chiếu và lý do chấp nhận/sửa" /></label></div>)}
                  {badPhone && <div className="grid gap-3 md:grid-cols-2"><label className="text-sm font-semibold">Số điện thoại đã xác minh<input type="tel" value={phones[file.id] || ""} onChange={(event) => setPhones((old) => ({ ...old, [file.id]: event.target.value }))} /></label><label className="text-sm font-semibold">Lý do sửa metadata<input type="text" value={phoneReasons[file.id] || ""} onChange={(event) => setPhoneReasons((old) => ({ ...old, [file.id]: event.target.value }))} /></label></div>}
                  <div className="flex flex-wrap gap-2"><Button onClick={() => reviewFile(file, "accepted")} disabled={busy}>Chấp nhận tệp</Button></div>
                </>}
                {mappingBlocked && file.review_status === "pending" && <p className="text-sm font-semibold text-red-700">Không thể chấp nhận: phạm vi thôn chưa được xác nhận chính thức. Hãy từ chối tệp và nêu rõ lý do để bảo toàn bằng chứng.</p>}
                {file.review_status === "pending" && <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
                  <label className="block text-sm font-semibold text-red-900">Lý do từ chối tệp
                    <input
                      type="text"
                      value={decisionReasons[file.id] || ""}
                      onChange={(event) => setDecisionReasons((old) => ({ ...old, [file.id]: event.target.value }))}
                      placeholder="Ví dụ: thiếu nguồn đối chiếu hoặc ranh giới Đông Sơn chưa có quyết định"
                    />
                  </label>
                  <Button variant="danger" onClick={() => reviewFile(file, "rejected")} disabled={busy || !(decisionReasons[file.id] || "").trim()}>Từ chối tệp</Button>
                </div>}
              </article>;
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
