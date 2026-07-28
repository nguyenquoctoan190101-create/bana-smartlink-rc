import type { UserRole } from "../types";

const ROLE_LABELS: Record<UserRole, string> = {
  admin_xa: "Cán bộ xã",
  can_bo_thon: "Cán bộ thôn",
  to_cnscd: "Tổ công nghệ số cộng đồng",
  lanh_dao: "Lãnh đạo xã",
  dan: "Người dân",
};

const ROLE_SCOPES: Record<UserRole, string> = {
  admin_xa: "Quản lý kỳ và tài khoản; xem toàn xã; phân công phản ánh; duyệt, khóa và công bố báo cáo. Mọi thao tác được ghi nhật ký kiểm toán.",
  can_bo_thon: "Tạo, sửa và nộp báo cáo đúng thôn được phân công; theo dõi công việc và dữ liệu trong phạm vi thôn.",
  to_cnscd: "Hỗ trợ các thôn được phân công; ghi nhận hỗ trợ và cập nhật tiến độ phản ánh. Không có quyền duyệt, khóa hoặc công bố.",
  lanh_dao: "Xem tóm tắt điều hành, báo cáo nội bộ, cảnh báo và tiến độ toàn xã. Không nhập, sửa, duyệt, khóa hoặc công bố báo cáo; chỉ quyết định yêu cầu thay đổi kỳ theo quy trình có ghi nhật ký.",
  dan: "Xem dữ liệu đã công bố, gửi kiến nghị hoặc phản ánh hiện trường và tra cứu bằng mã hồ sơ.",
};

export function getRoleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? "Khách";
}

export function getRoleScope(role: UserRole): string {
  return ROLE_SCOPES[role] ?? "Chưa xác định phạm vi quyền.";
}

export function resolveRoleVillageIds(
  role: UserRole,
  primaryVillageId: string | null,
  assignedVillageIds: string[] = [],
): string[] {
  if (role === "can_bo_thon") {
    return primaryVillageId ? [primaryVillageId] : [];
  }
  if (role !== "to_cnscd") return [];
  return Array.from(
    new Set(
      [primaryVillageId, ...assignedVillageIds].filter(
        (villageId): villageId is string => Boolean(villageId),
      ),
    ),
  ).sort();
}
