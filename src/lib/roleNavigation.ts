import type { UserRole } from "../types";

export type AppTab =
  | "dashboard"
  | "progress-dashboard"
  | "report-form"
  | "citizen-proposal"
  | "admin-panel"
  | "policy-scorecard"
  | "cnscd-impact"
  | "create-period"
  | "period-change-requests"
  | "pending-updates"
  | "operations"
  | "legacy-import"
  | "knowledge"
  | "cases"
  | "pilots"
  | "record-lookup";

export const APP_TAB_TITLES: Record<AppTab, string> = {
  dashboard: "Báo cáo tổng hợp",
  "progress-dashboard": "Tiến độ báo cáo",
  "report-form": "Lập báo cáo định kỳ",
  "citizen-proposal": "Đề nghị đối chiếu số liệu",
  "admin-panel": "Quản lý tài khoản",
  "policy-scorecard": "Chỉ số báo cáo điện tử",
  "cnscd-impact": "Kết quả hỗ trợ chuyển đổi số",
  "create-period": "Kỳ và biểu mẫu báo cáo",
  "period-change-requests": "Phê duyệt thay đổi kỳ báo cáo",
  "pending-updates": "Xử lý đề nghị đối chiếu",
  operations: "Công việc điều hành",
  "legacy-import": "Nhập dữ liệu lịch sử",
  knowledge: "Tài liệu và hỗ trợ nghiệp vụ",
  cases: "Phản ánh hiện trường",
  pilots: "Mô hình thử nghiệm",
  "record-lookup": "Tra cứu hồ sơ",
};

const BASE_ROLE_TABS: Record<UserRole, readonly AppTab[]> = {
  admin_xa: [
    "dashboard",
    "progress-dashboard",
    "policy-scorecard",
    "cnscd-impact",
    "create-period",
    "admin-panel",
    "pending-updates",
    "operations",
    "legacy-import",
    "knowledge",
    "cases",
    "record-lookup",
  ],
  can_bo_thon: [
    "dashboard",
    "report-form",
    "citizen-proposal",
    "operations",
    "knowledge",
    "cases",
    "record-lookup",
  ],
  to_cnscd: [
    "dashboard",
    "report-form",
    "cnscd-impact",
    "citizen-proposal",
    "operations",
    "knowledge",
    "cases",
    "record-lookup",
  ],
  lanh_dao: [
    "dashboard",
    "progress-dashboard",
    "policy-scorecard",
    "cnscd-impact",
    "operations",
    "knowledge",
    "cases",
    "record-lookup",
    "period-change-requests",
  ],
  dan: ["dashboard", "citizen-proposal", "record-lookup"],
};

export const DEFAULT_TAB_BY_ROLE: Record<UserRole, AppTab> = {
  admin_xa: "operations",
  can_bo_thon: "operations",
  to_cnscd: "operations",
  lanh_dao: "operations",
  dan: "dashboard",
};

export function allowedTabsForRole(
  role: UserRole,
  pilotsEnabled = false,
): ReadonlySet<AppTab> {
  const tabs = new Set(BASE_ROLE_TABS[role]);
  if (pilotsEnabled && (role === "admin_xa" || role === "lanh_dao")) {
    tabs.add("pilots");
  }
  return tabs;
}

export function isTabAllowedForRole(
  role: UserRole,
  tab: AppTab,
  pilotsEnabled = false,
): boolean {
  return allowedTabsForRole(role, pilotsEnabled).has(tab);
}
