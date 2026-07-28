/** Resolve the shared public lookup route by the opaque code format. */
export const EXAMPLE_LOOKUP_CODES = [
  "A1B2C3D4E5F6G7H8",
  "A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6",
] as const;

export function isExampleLookupCode(code: string): boolean {
  const normalized = code.trim().toUpperCase();
  return EXAMPLE_LOOKUP_CODES.some(
    (exampleCode) => exampleCode === normalized,
  );
}

export function getPublicLookupEndpoint(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (normalized.length === 16) return `/auth/citizen/pending-updates/${encodeURIComponent(normalized)}`;
  if (normalized.length === 32) return `/api/cases/track/${encodeURIComponent(normalized)}`;
  return null;
}

const PUBLIC_CASE_CATEGORY_LABELS: Record<string, string> = {
  road: "Đường giao thông",
  drainage: "Thoát nước, ngập úng",
  power: "Điện, chiếu sáng",
  lighting: "Điện, chiếu sáng",
  waste: "Rác thải",
  water: "Nước và cấp nước",
  public_building: "Công trình công cộng",
  public_facility: "Công trình công cộng",
  safety: "An toàn, nguy cơ khẩn cấp",
  emergency: "An toàn, nguy cơ khẩn cấp",
  other: "Nội dung khác",
};

export function getPublicCaseCategoryLabel(category: string): string {
  return PUBLIC_CASE_CATEGORY_LABELS[category] ?? "Loại sự cố khác";
}

const PUBLIC_STATUS_LABELS: Record<string, string> = {
  received: "Đã tiếp nhận",
  verifying: "Đang xác minh",
  assigned: "Đã phân công",
  in_progress: "Đang xử lý",
  completed: "Hoàn thành",
  out_of_scope: "Không thuộc thẩm quyền",
  accepted: "Đã chấp nhận",
  rejected: "Đã từ chối",
  not_found: "Không tìm thấy",
  invalid_code: "Mã chưa hợp lệ",
  unavailable: "Chưa thể tra cứu",
};

export function getPublicStatusLabel(status: string): string {
  return PUBLIC_STATUS_LABELS[status] ?? "Đang cập nhật";
}

export type PublicLookupResult = {
  status: string;
  message?: string;
  case?: { category?: string };
};

export function formatPublicLookupMessage(result: PublicLookupResult): string {
  const status = getPublicStatusLabel(result.status);
  const category = result.case?.category ? ` · Loại sự cố: ${getPublicCaseCategoryLabel(result.case.category)}` : "";
  return result.message ? `● ${status}${category} · ${result.message}` : `● ${status}${category}`;
}
