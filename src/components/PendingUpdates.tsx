import React, { useEffect, useState } from "react";
import { 
  Check, X, AlertCircle, RefreshCw, ClipboardCheck, 
  Calendar, MapPin, Eye, FileText, ArrowRight, 
  Activity, Shield, CheckCircle2, XCircle
} from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { useVillages } from "../lib/useVillages";

interface PendingUpdatesProps {
  userRole: string;
  userVillageId: string | null;
  userName: string;
  onUpdateProcessed?: () => void;
}

interface Proposal {
  id: string;
  report_id: string;
  village_id: string;
  proposed_changes: Record<string, number>;
  previous_value?: number | null;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
  reviewed_at?: string;
  sla_due_at?: string;
  sla_status?: "on_track" | "overdue" | "closed";
}

interface ProposalApiRow {
  id: string;
  report_id: string;
  village_id?: string;
  ct_code: string;
  proposed_value: number;
  previous_value?: number | null;
  proposed_by?: string | null;
  status: string;
  created_at?: string;
  reviewed_at?: string | null;
  sla_due_at?: string;
  sla_status?: "on_track" | "overdue" | "closed";
}

interface ReportValue {
  report_id: string;
  ct_code: string;
  value: number;
}

interface AuditLog {
  id: string;
  table_name: string;
  row_id: string;
  action: string;
  actor: string;
  payload: any;
  created_at: string;
}

interface AuditLogApiRow {
  id: string | number;
  table_name: string;
  record_id?: string;
  row_id?: string;
  action: string;
  user_id?: string | null;
  actor?: string;
  details?: string | Record<string, unknown> | null;
  payload?: Record<string, unknown>;
  created_at: string;
}

export default function PendingUpdates({ 
  userRole, 
  userVillageId, 
  userName,
  onUpdateProcessed 
}: PendingUpdatesProps) {
  const { villages: new_villages } = useVillages();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [reportValues, setReportValues] = useState<ReportValue[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Tab states: 'pending' (default) or 'history'
  const [statusFilter, setStatusFilter] = useState<"Pending" | "Processed">("Pending");

  const getIndicatorName = (code: string) => {
    const names: Record<string, string> = {
      CT01: "Tổng số hộ dân",
      CT02: "Tổng số nhân khẩu",
      CT03: "Số hộ nghèo",
      CT04: "Số hộ cận nghèo",
      CT05: "Người có công",
      CT06: "Bảo trợ xã hội",
      CT07: "Trẻ em dưới 16",
      CT08: "Trẻ em có hoàn cảnh đặc biệt",
      CT09: "Số hộ Gia đình văn hóa",
      CT10: "Lao động trong độ tuổi",
      CT11: "Người tham gia BHYT",
      CT12: "Thành viên Tổ Công nghệ số",
      CT13: "Lượt hướng dẫn DVC trực tuyến",
      CT14: "Số vụ bạo lực gia đình"
    };
    return names[code] || code;
  };

  const getVillageName = (id: string) => {
    return new_villages.find(v => v.id === id)?.name || id;
  };

  // Load all required states
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch proposals
      const url = userRole === "admin_xa" 
        ? "/auth/proposals" 
        : `/auth/proposals?village_id=${userVillageId || ""}`;
      
      const dataProposals = await apiJson<ProposalApiRow[]>(url);
      setProposals((Array.isArray(dataProposals) ? dataProposals : []).map((item) => ({
        id: item.id,
        report_id: item.report_id,
        village_id: item.village_id || "",
        proposed_changes: { [item.ct_code]: item.proposed_value },
        previous_value: item.previous_value,
        status: item.status.toLowerCase() === "approved" ? "Approved" : item.status.toLowerCase() === "rejected" ? "Rejected" : "Pending",
        created_at: item.created_at || "",
        reviewed_at: item.reviewed_at || undefined,
        sla_due_at: item.sla_due_at,
        sla_status: item.sla_status,
      })));

      // 2. Fetch mock report values (central DB)
      const dataValues = await apiJson<ReportValue[]>("/auth/report-values");
      setReportValues(Array.isArray(dataValues) ? dataValues : []);

      // 3. Fetch audit logs
      const dataLogs = await apiJson<AuditLogApiRow[]>("/auth/audit-logs");
      setAuditLogs((Array.isArray(dataLogs) ? dataLogs : []).map((item) => {
        let payload: Record<string, unknown> = item.payload || {};
        if (!item.payload && typeof item.details === "string") {
          try { payload = JSON.parse(item.details); } catch { payload = {}; }
        } else if (!item.payload && item.details && typeof item.details === "object") {
          payload = item.details;
        }
        return {
          id: String(item.id),
          table_name: item.table_name,
          row_id: item.row_id || item.record_id || "",
          action: item.action,
          actor: item.actor || item.user_id || "Hệ thống",
          payload,
          created_at: item.created_at,
        };
      }));

    } catch (err) {
      setError(toUserFacingError(err, "Đã xảy ra lỗi khi tải dữ liệu."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [userRole, userVillageId]);

  // Handle Approve/Reject action with atomic backend execution
  const handleAction = async (proposalId: string, action: "approve" | "reject") => {
    if (userRole !== "admin_xa") {
      setError("Chỉ quản trị xã được phê duyệt hoặc từ chối đề xuất.");
      return;
    }
    setError(null);
    setSuccess(null);
    setActionLoading(proposalId);

    try {
      await apiJson(`/auth/proposals/${proposalId}/action`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      setSuccess(action === "approve" ? "Đã phê duyệt đề xuất và ghi nhật ký kiểm toán." : "Đã từ chối đề xuất và ghi nhật ký kiểm toán.");

      // Refresh states
      await loadData();
      if (onUpdateProcessed) {
        onUpdateProcessed();
      }
    } catch (err) {
      setError(toUserFacingError(err, "Giao dịch thất bại."));
    } finally {
      setActionLoading(null);
    }
  };

  // Filter proposals based on selected filter
  const filteredProposals = proposals.filter(p => {
    if (statusFilter === "Pending") {
      return p.status === "Pending";
    } else {
      return p.status === "Approved" || p.status === "Rejected";
    }
  });

  // Processed approvals must use the immutable audit snapshot, never the
  // report's current value (which already contains the approved change).
  const getOldValue = (proposal: Proposal, ctCode: string): number | null => {
    if (proposal.status !== "Pending") {
      return typeof proposal.previous_value === "number" ? proposal.previous_value : null;
    }
    const valObj = reportValues.find(v => v.report_id === proposal.report_id && v.ct_code === ctCode);
    return valObj ? valObj.value : null;
  };

  const formatSla = (proposal: Proposal) => {
    if (!proposal.sla_due_at) return "Chưa xác định SLA";
    const due = new Date(proposal.sla_due_at);
    const dueText = Number.isNaN(due.getTime()) ? proposal.sla_due_at : due.toLocaleString("vi-VN");
    if (proposal.sla_status === "overdue") return `Quá hạn phản hồi từ ${dueText}`;
    if (proposal.sla_status === "closed") return "Đã đóng kiến nghị";
    return `Cần xử lý trước ${dueText}`;
  };

  return (
    <div className="space-y-6" id="pending-updates-panel">
      {/* Upper header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-3xs">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-5.5 h-5.5 text-emerald-800" />
            <span>Thẩm định kiến nghị sửa đổi số liệu</span>
          </h2>
          <p className="text-2xs text-slate-500 mt-1">
            {userRole === "admin_xa" 
              ? "Quyền hạn: Admin Xã - Xem toàn bộ đề xuất chỉnh sửa từ nhân dân 10 thôn."
              : `Quyền hạn: Cán bộ thôn - Xem đề xuất chỉnh sửa riêng của địa bàn ${getVillageName(userVillageId || "")}.`}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 active:scale-95 px-3.5 py-2 rounded-xl text-2xs font-bold shadow-3xs transition-all cursor-pointer self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Làm mới dữ liệu</span>
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-800 p-4 rounded-xl text-2xs flex items-start gap-2.5 shadow-3xs">
          <AlertCircle className="w-4.5 h-4.5 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-4 rounded-xl text-2xs flex items-start gap-2.5 shadow-3xs">
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Grid Layout: Main Queue and Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main proposals list */}
        <div className="lg:col-span-2 space-y-4">
          
          {/* Filters Tab */}
          <div className="flex border-b border-slate-200 bg-white px-4 rounded-xl border border-slate-100 shadow-3xs">
            <button
              onClick={() => setStatusFilter("Pending")}
              className={`py-3 px-4 text-2xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                statusFilter === "Pending"
                  ? "border-emerald-800 text-emerald-950 font-black"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <span>Chờ phê duyệt</span>
              <span className={`px-1.5 py-0.5 text-4xs rounded-full ${
                statusFilter === "Pending" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500"
              }`}>
                {proposals.filter(p => p.status === "Pending").length}
              </span>
            </button>
            <button
              onClick={() => setStatusFilter("Processed")}
              className={`py-3 px-4 text-2xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                statusFilter === "Processed"
                  ? "border-emerald-800 text-emerald-950 font-black"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <span>Lịch sử xử lý</span>
              <span className="px-1.5 py-0.5 text-4xs rounded-full bg-slate-100 text-slate-500">
                {proposals.filter(p => p.status !== "Pending").length}
              </span>
            </button>
          </div>

          {isLoading ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-3xs">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-800 mx-auto" />
              <p className="text-2xs text-slate-500 mt-3 font-semibold">Đang truy xuất dữ liệu từ máy chủ...</p>
            </div>
          ) : filteredProposals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-3xs space-y-3">
              <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto" />
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Không có đề xuất nào</h3>
                <p className="text-2xs text-slate-400 mt-1">
                  {statusFilter === "Pending" 
                    ? "Tất cả các kiến nghị chỉnh sửa từ người dân đã được thẩm định xong."
                    : "Chưa có đề xuất nào được phê duyệt hoặc từ chối trong phiên làm việc."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredProposals.map((proposal) => (
                <div 
                  key={proposal.id} 
                  className={`bg-white rounded-2xl border transition-all p-5 shadow-3xs flex flex-col gap-4 ${
                    proposal.status === "Pending" 
                      ? "border-slate-100 hover:border-slate-200"
                      : proposal.status === "Approved"
                      ? "border-emerald-100 bg-emerald-25/10"
                      : "border-rose-100 bg-rose-25/10"
                  }`}
                >
                  {/* Top metadata row */}
                  <div className="flex flex-wrap justify-between items-start gap-2 border-b border-slate-100 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs text-slate-900 tracking-tight flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-emerald-800" />
                          <span>{getVillageName(proposal.village_id)}</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded text-4xs font-bold uppercase ${
                          proposal.status === "Pending" 
                            ? "bg-amber-100 text-amber-800"
                            : proposal.status === "Approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}>
                          {proposal.status === "Pending" ? "Chờ duyệt" : proposal.status === "Approved" ? "Đã duyệt" : "Từ chối"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-4xs text-slate-400 font-semibold font-mono">
                        <span className="flex items-center gap-0.5">
                          <Calendar className="w-3 h-3" />
                          {new Date(proposal.created_at).toLocaleString("vi-VN")}
                        </span>
                        <span>•</span>
                        <span>Mã báo cáo: {proposal.report_id}</span>
                      </div>
                    </div>

                  </div>

                  {proposal.status === "Pending" && (
                    <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${proposal.sla_status === "overdue" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>
                      {formatSla(proposal)}
                    </p>
                  )}

                  {/* Core Value Comparison Card */}
                  <div className="space-y-2">
                    <span className="block text-4xs font-bold text-slate-400 uppercase tracking-wider">Chi tiết điều chỉnh đề xuất:</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(proposal.proposed_changes).map(([ct_code, proposed_val]) => {
                        const old_val = getOldValue(proposal, ct_code);
                        const oldValueLabel = old_val == null
                          ? proposal.status === "Pending" ? "Chưa có dữ liệu" : "Không lưu snapshot"
                          : old_val;
                        return (
                          <div key={ct_code} className="border border-slate-100 rounded-xl p-3 bg-slate-25/40 flex flex-col justify-between gap-2.5">
                            <div>
                              <span className="font-bold text-slate-700 text-3xs font-mono">{ct_code}</span>
                              <p className="font-semibold text-slate-800 text-2xs mt-0.5 line-clamp-1">{getIndicatorName(ct_code)}</p>
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-100/60 pt-2">
                              <div className="text-center flex-1">
                                <span className="block text-4xs text-slate-400 font-bold uppercase tracking-wide">Giá trị cũ</span>
                                <span className="font-mono font-bold text-slate-600 text-sm">{oldValueLabel}</span>
                              </div>
                              <div className="px-2">
                                <ArrowRight className="w-4 h-4 text-slate-300" />
                              </div>
                              <div className="text-center flex-1">
                                <span className="block text-4xs text-emerald-800 font-bold uppercase tracking-wide">Đề xuất mới</span>
                                <span className="font-mono font-black text-emerald-600 text-sm">{proposed_val}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action buttons (only for pending) */}
                  {proposal.status === "Pending" && (
                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100/60">
                      <button
                        onClick={() => handleAction(proposal.id, "reject")}
                        disabled={actionLoading !== null}
                        className="flex items-center gap-1 border border-slate-200 hover:border-rose-200 text-slate-600 hover:text-rose-600 bg-white px-3.5 py-1.5 rounded-lg text-2xs font-bold shadow-3xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                      >
                        {actionLoading === proposal.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        <span>Từ chối kiến nghị</span>
                      </button>
                      <button
                        onClick={() => handleAction(proposal.id, "approve")}
                        disabled={actionLoading !== null}
                        className="flex items-center gap-1 bg-emerald-800 hover:bg-emerald-900 text-white px-4 py-1.5 rounded-lg text-2xs font-bold shadow-3xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                      >
                        {actionLoading === proposal.id ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Phê duyệt (Giao dịch đồng thời)</span>
                      </button>
                    </div>
                  )}

                  {/* Reviewed timestamp for processed ones */}
                  {proposal.status !== "Pending" && proposal.reviewed_at && (
                    <div className="text-4xs text-slate-400 font-semibold italic text-right mt-1">
                      Đã xử lý lúc: {new Date(proposal.reviewed_at).toLocaleString("vi-VN")}
                    </div>
                  )}

                </div>
              ))}
            </div>
          )}

        </div>

        {/* Right sidebar: Real-time Audit Logs Panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-3xs space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Shield className="w-4.5 h-4.5 text-emerald-800" />
              <div>
                <h3 className="font-bold text-slate-800 text-xs">Nhật ký thay đổi (Audit Log)</h3>
                <p className="text-4xs text-slate-400 mt-0.5">Lưu vết tự động trong cùng 1 transaction</p>
              </div>
            </div>

            {isLoading ? (
              <div className="py-6 text-center text-slate-400 text-2xs">Đang tải nhật ký...</div>
            ) : auditLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-2xs space-y-1">
                <Activity className="w-8 h-8 text-slate-200 mx-auto" />
                <p>Chưa có lịch sử audit log nào được ghi nhận.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div key={log.id} className="bg-slate-25/50 border border-slate-100 rounded-xl p-3.5 text-4xs space-y-2">
                    <div className="flex justify-between items-start gap-1">
                      <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded text-xs">
                        {log.action}
                      </span>
                      <span className="text-slate-400 font-mono font-medium">
                        {new Date(log.created_at).toLocaleTimeString("vi-VN")}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-slate-600">
                      <div>Tác nhân: <b className="text-slate-800">{log.actor}</b></div>
                      <div>Bảng ghi: <span className="font-mono text-slate-700">{log.table_name}</span></div>
                      <div>Khóa dòng: <span className="font-mono text-slate-700 text-[10px] break-all">{log.row_id}</span></div>
                    </div>

                    {/* Show payload changes recursively */}
                    {log.payload && log.payload.changes && (
                      <div className="border-t border-slate-100/80 pt-2 space-y-1">
                        <span className="block font-bold text-slate-400 uppercase tracking-wide">Thay đổi:</span>
                        <div className="space-y-1">
                          {log.payload.changes.map((ch: any, idx: number) => (
                            <div key={idx} className="flex justify-between bg-white border border-slate-100 px-1.5 py-0.5 rounded-sm">
                              <span className="font-bold text-slate-700 font-mono">{ch.ct_code}</span>
                              <span className="text-slate-500 font-semibold flex items-center gap-1 font-mono">
                                <span>{ch.old_value !== null ? ch.old_value : "null"}</span>
                                <ArrowRight className="w-2.5 h-2.5 text-slate-300" />
                                <span className="text-emerald-700 font-black">{ch.new_value}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
