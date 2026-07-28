import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, Route, ShieldCheck } from "lucide-react";
import type { UserRole } from "../types";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { Button, EmptyState, ErrorState, MetricCard, PageHeader, SectionCard, StatusBadge } from "./ui";

type Village = { id: string; name: string };
type CaseItem = {
  id: string;
  village_id?: string | null;
  category: string;
  description: string;
  priority: string;
  status: string;
  assigned_department?: string | null;
  sla_due_at?: string | null;
  routing_rule_id?: string | null;
  created_at: string;
  updated_at: string;
};
type RoutingRule = {
  id: string;
  category: string;
  department: string;
  priority: string;
  verification_minutes: number;
  resolution_minutes: number;
  escalation_department?: string | null;
  is_active: boolean;
  is_demo: boolean;
  sla_version: string;
};

const categoryLabels: Record<string, string> = {
  road: "Đường giao thông",
  waste: "Rác thải",
  water: "Nước và cấp nước",
  power: "Điện, chiếu sáng",
  public_building: "Công trình công cộng",
  drainage: "Thoát nước, ngập úng",
  safety: "An toàn, nguy cơ khẩn cấp",
  other: "Nội dung khác",
};

const statusLabels: Record<string, string> = {
  received: "Đã tiếp nhận",
  verifying: "Đang xác minh",
  assigned: "Đã phân công",
  in_progress: "Đang xử lý",
  completed: "Hoàn thành",
  out_of_scope: "Không thuộc thẩm quyền",
  rejected: "Từ chối",
};

const terminalStatuses = ["completed", "out_of_scope", "rejected"];

export function allowedNextCaseStatuses(status: string, role: UserRole): string[] {
  if (role === "to_cnscd") {
    if (status === "assigned") return ["in_progress"];
    if (status === "in_progress") return ["completed"];
    return [];
  }
  if (role !== "admin_xa") return [];
  if (status === "received") return ["verifying", "out_of_scope", "rejected"];
  if (status === "verifying") return ["out_of_scope", "rejected"];
  if (status === "assigned") return ["verifying", "in_progress"];
  if (status === "in_progress") return ["assigned", "completed"];
  return [];
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  if (minutes % 1440 === 0) return `${minutes / 1440} ngày`;
  if (minutes % 60 === 0) return `${minutes / 60} giờ`;
  return `${minutes} phút`;
}

function formatDate(value?: string | null): string {
  if (!value) return "Chưa xác định";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Chưa xác định"
    : date.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}

function routingVersionLabel(value?: string): string {
  const demoDate = value?.match(/^demo-(\d{4})-(\d{2})-(\d{2})$/);
  if (demoDate) {
    return `Cấu hình thử nghiệm · cập nhật ${demoDate[3]}/${demoDate[2]}/${demoDate[1]}`;
  }
  return value
    ? "Cấu hình nội bộ đã được thiết lập"
    : "Chưa có thông tin phiên bản cấu hình";
}

export default function CaseManagement({ role, villages }: { role: UserRole; villages: Village[] }) {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [departments, setDepartments] = useState<Record<string, string>>({});
  const [nextStatuses, setNextStatuses] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const admin = role === "admin_xa";
  const canUpdate = admin || role === "to_cnscd";
  const villageNames = useMemo(() => new Map(villages.map((village) => [village.id, village.name])), [villages]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [caseRows, ruleRows] = await Promise.all([apiJson<CaseItem[]>("/api/cases"), apiJson<RoutingRule[]>("/api/cases/routing-rules")]);
      setCases(caseRows);
      setRules(ruleRows);
      setStatusFilter((current) => {
        const hasOpenCases = caseRows.some(
          (item) => !terminalStatuses.includes(item.status),
        );
        return current === "open" && !hasOpenCases && caseRows.length > 0
          ? "all"
          : current;
      });
      setDepartments((current) => {
        const next = { ...current };
        for (const item of caseRows) {
          if (!next[item.id]) {
            next[item.id] = item.assigned_department || ruleRows.find((rule) => rule.category === item.category && rule.priority === item.priority)?.department || ruleRows.find((rule) => rule.category === item.category)?.department || "";
          }
        }
        return next;
      });
    } catch (cause) {
      setError(toUserFacingError(cause, "Không tải được danh sách phản ánh."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [role]);

  const visibleCases = useMemo(() => {
    if (statusFilter === "all") return cases;
    if (statusFilter === "open") {
      return cases.filter((item) => !["completed", "out_of_scope", "rejected"].includes(item.status));
    }
    return cases.filter((item) => item.status === statusFilter);
  }, [cases, statusFilter]);

  const overdue = useMemo(() => cases.filter((item) => item.sla_due_at && new Date(item.sla_due_at).getTime() < Date.now() && !["completed", "out_of_scope", "rejected"].includes(item.status)), [cases]);
  const open = cases.filter((item) => !["completed", "out_of_scope", "rejected"].includes(item.status));
  const demoRules = rules.some((rule) => rule.is_demo);

  const assign = async (item: CaseItem) => {
    const department = departments[item.id]?.trim();
    if (!department) {
      setNotice("Hãy chọn đơn vị tiếp nhận trước khi xác nhận phân công.");
      return;
    }
    setBusyId(item.id);
    setNotice(null);
    try {
      await apiJson(`/api/cases/${item.id}/assignment`, {
        method: "POST",
        body: JSON.stringify({ department }),
      });
      setNotice("Đã xác nhận phân công. Thời hạn xử lý được tính lại theo cấu hình nội bộ.");
      await refresh();
    } catch (cause) {
      setNotice(toUserFacingError(cause, "Không thể phân công phản ánh."));
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (item: CaseItem) => {
    const nextStatus = nextStatuses[item.id];
    const note = notes[item.id]?.trim();
    if (!nextStatus) {
      setNotice("Hãy chọn trạng thái cần cập nhật.");
      return;
    }
    if (terminalStatuses.includes(nextStatus) && !note) {
      setNotice("Hãy ghi rõ kết quả xử lý hoặc lý do trước khi đóng phản ánh.");
      return;
    }
    setBusyId(item.id);
    setNotice(null);
    try {
      await apiJson(`/api/cases/${item.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
          note: note || undefined,
        }),
      });
      setNotice("Đã cập nhật trạng thái phản ánh.");
      setNextStatuses((current) => ({ ...current, [item.id]: "" }));
      setNotes((current) => ({ ...current, [item.id]: "" }));
      await refresh();
    } catch (cause) {
      setNotice(toUserFacingError(cause, "Không thể cập nhật trạng thái."));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-800" />
        Đang tải trung tâm phản ánh…
      </div>
    );
  }
  if (error) {
    return <ErrorState description={error} onRetry={() => void refresh()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="TIẾP NHẬN VÀ XỬ LÝ"
        title={role === "lanh_dao" ? "Giám sát phản ánh hiện trường" : "Trung tâm xử lý phản ánh"}
        description="Tiếp nhận, xác minh, phân công và theo dõi phản ánh theo đúng phạm vi quyền. Không hiển thị thông tin liên hệ của người gửi trên màn hình tổng hợp."
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw />
            Làm mới
          </Button>
        }
      />

      {demoRules && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>Dữ liệu minh họa · Thời hạn xử lý đang dùng cấu hình thử nghiệm.</strong>
            <p className="mt-1">Danh mục đơn vị và thời hạn bên dưới chưa phải cam kết hành chính chính thức; cần UBND xã rà soát trước khi vận hành chính thức.</p>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800">
          {notice}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Tổng phản ánh" value={cases.length} context="Trong phạm vi được xem" tone="info" icon={<Route />} />
        <MetricCard label="Đang mở" value={open.length} context="Chưa kết thúc xử lý" tone="warning" icon={<Clock3 />} />
        <MetricCard label="Quá hạn xử lý" value={overdue.length} context={overdue.length ? "Cần ưu tiên kiểm tra" : "Không có phản ánh quá hạn"} tone={overdue.length ? "danger" : "success"} icon={<AlertTriangle />} />
        <MetricCard label="Hoàn thành" value={cases.filter((item) => item.status === "completed").length} context="Đã đóng quy trình" tone="success" icon={<CheckCircle2 />} />
      </div>

      <SectionCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Danh sách phản ánh cần xử lý</h2>
            <p className="mt-1 text-sm text-slate-600">Lãnh đạo và cán bộ thôn chỉ xem; quản trị xã xác nhận phân công, Tổ công nghệ số cộng đồng được cập nhật tiến độ.</p>
            {statusFilter === "all" && open.length === 0 && cases.length > 0 && (
              <p className="mt-2 text-sm font-semibold text-emerald-800" role="status">
                Không có phản ánh đang mở; hệ thống đang hiển thị toàn bộ hồ sơ
                gần nhất để tránh một hàng đợi trống.
              </p>
            )}
          </div>
          <label className="text-sm font-semibold text-slate-700">
            Trạng thái
            <select className="mt-1 min-w-52" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="open">Đang mở</option>
              <option value="all">Tất cả</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-4 p-5">
          {!visibleCases.length && <EmptyState title="Chưa có phản ánh trong bộ lọc" description="Hãy chọn “Tất cả” để xem hồ sơ đã hoàn thành; phản ánh mới từ cổng người dân sẽ xuất hiện tại đây theo đúng phạm vi quyền." />}
          {visibleCases.map((item) => {
            const isTerminal = ["completed", "out_of_scope", "rejected"].includes(item.status);
            const isOverdue = Boolean(item.sla_due_at) && new Date(item.sla_due_at as string).getTime() < Date.now() && !isTerminal;
            const matchingDepartments = Array.from(new Set(rules.filter((rule) => rule.category === item.category).map((rule) => rule.department)));
            const allowedStatuses = allowedNextCaseStatuses(item.status, role);

            return (
              <article key={item.id} className="case-status-card rounded-xl border border-slate-200 bg-white p-4 md:p-5" data-status={isOverdue ? "overdue" : item.status}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={isOverdue ? "overdue" : item.status} label={isOverdue ? "Quá hạn xử lý" : statusLabels[item.status] || "Trạng thái chưa xác định"} />
                      <span className="text-xs font-semibold text-slate-500">{categoryLabels[item.category] || "Nội dung khác"}</span>
                      <span className="text-xs text-slate-400">Mã nội bộ {item.id.slice(0, 8).toUpperCase()}</span>
                    </div>
                    <h3 className="mt-3 font-bold text-slate-900">{villageNames.get(item.village_id || "") || "Chưa xác định thôn"}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{item.description}</p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Tiếp nhận</dt>
                        <dd className="mt-1 font-medium text-slate-800">{formatDate(item.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Đơn vị xử lý</dt>
                        <dd className="mt-1 font-medium text-slate-800">{item.assigned_department || "Chưa có gợi ý"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-slate-500">Hạn xử lý</dt>
                        <dd className={`mt-1 font-medium ${isOverdue ? "text-rose-700" : "text-slate-800"}`}>{formatDate(item.sla_due_at)}</dd>
                      </div>
                    </dl>
                    {isTerminal && <p className="mt-4 text-xs font-semibold text-slate-500">Đã đóng quy trình — chỉ xem.</p>}
                  </div>

                  {(admin || canUpdate) && !isTerminal && (admin || allowedStatuses.length > 0) && (
                    <div className="w-full space-y-3 rounded-xl bg-slate-50 p-4 xl:w-96">
                      {admin && (
                        <div>
                          <label className="text-sm font-semibold text-slate-700">
                            Đơn vị tiếp nhận
                            <select
                              className="mt-1 w-full"
                              value={departments[item.id] || ""}
                              onChange={(event) =>
                                setDepartments((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Chọn đơn vị</option>
                              {matchingDepartments.map((department) => (
                                <option key={department} value={department}>
                                  {department}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button className="mt-2 w-full" disabled={busyId === item.id || !departments[item.id]?.trim()} onClick={() => void assign(item)}>
                            {busyId === item.id ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                            Xác nhận phân công
                          </Button>
                        </div>
                      )}
                      {canUpdate && allowedStatuses.length > 0 && (
                        <div className="border-t border-slate-200 pt-3">
                          <label className="text-sm font-semibold text-slate-700">
                            Cập nhật tiến độ
                            <select
                              className="mt-1 w-full"
                              value={nextStatuses[item.id] || ""}
                              onChange={(event) =>
                                setNextStatuses((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Chọn trạng thái mới</option>
                              {allowedStatuses.map((status) => (
                                <option key={status} value={status}>
                                  {statusLabels[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="mt-3 block text-sm font-semibold text-slate-700">
                            Ghi chú xử lý
                            {terminalStatuses.includes(nextStatuses[item.id]) ? " (bắt buộc)" : " (không bắt buộc)"}
                            <textarea
                              className="mt-1 w-full"
                              rows={3}
                              maxLength={2000}
                              value={notes[item.id] || ""}
                              onChange={(event) =>
                                setNotes((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="Nêu kết quả kiểm tra, căn cứ hoặc lý do chuyển trạng thái…"
                            />
                          </label>
                          <Button
                            variant="secondary"
                            className="mt-2 w-full"
                            disabled={busyId === item.id || !nextStatuses[item.id] || (terminalStatuses.includes(nextStatuses[item.id]) && !notes[item.id]?.trim())}
                            onClick={() => void updateStatus(item)}
                          >
                            Cập nhật trạng thái
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-slate-900">Danh mục và thời hạn xử lý</h2>
          <p className="mt-1 text-sm text-slate-600">{routingVersionLabel(rules[0]?.sla_version)}. Các mốc thời gian là mục tiêu xử lý nội bộ của cấu hình thử nghiệm, không phải cam kết pháp lý.</p>
        </div>
        <div
          className="table-scroll-region overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-700"
          tabIndex={0}
          aria-label="Bảng danh mục và thời hạn xử lý; có thể cuộn ngang trên màn hình nhỏ"
        >
          <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
            Vuốt ngang để xem thêm →
          </span>
          <table className="min-w-[900px]">
            <thead>
              <tr>
                <th>Loại sự cố</th>
                <th>Đơn vị tiếp nhận</th>
                <th>Xác minh</th>
                <th>Xử lý</th>
                <th>Quá hạn chuyển</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="font-semibold">{categoryLabels[rule.category] || "Nội dung khác"}</td>
                  <td>{rule.department}</td>
                  <td>{formatDuration(rule.verification_minutes)}</td>
                  <td>{formatDuration(rule.resolution_minutes)}</td>
                  <td>{rule.escalation_department || "Chưa cấu hình"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
