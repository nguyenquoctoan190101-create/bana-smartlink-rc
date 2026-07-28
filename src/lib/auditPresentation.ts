const AUDIT_ACTION_LABELS: Record<string, string> = {
  INSERT: "Tạo bản ghi",
  UPDATE: "Cập nhật bản ghi",
  DELETE: "Xóa bản ghi",
  CREATE_REPORT_PERIOD: "Tạo kỳ báo cáo",
  ATTACH_REPORT_PERIOD_TEMPLATE: "Cập nhật biểu mẫu kỳ báo cáo",
  REQUEST_REPORT_PERIOD_UPDATE: "Đề nghị điều chỉnh kỳ báo cáo",
  REQUEST_REPORT_PERIOD_DELETE: "Đề nghị xóa kỳ báo cáo",
  APPROVED_REPORT_PERIOD_UPDATE: "Phê duyệt điều chỉnh kỳ báo cáo",
  APPROVED_REPORT_PERIOD_DELETE: "Phê duyệt xóa kỳ báo cáo",
  REJECTED_REPORT_PERIOD_UPDATE: "Từ chối điều chỉnh kỳ báo cáo",
  REJECTED_REPORT_PERIOD_DELETE: "Từ chối xóa kỳ báo cáo",
  PROPOSAL_APPROVE: "Phê duyệt kiến nghị",
  PROPOSAL_REJECT: "Từ chối kiến nghị",
  REPORT_SUBMIT: "Nộp báo cáo",
  REPORT_APPROVE: "Duyệt báo cáo",
  REPORT_LOCK: "Khóa báo cáo",
  REPORT_PUBLISH: "Công bố báo cáo",
  REPORT_DELETE: "Xóa báo cáo",
  REVIEW_EXTRACTED_REPORT: "Xác nhận số liệu được trích xuất",
  BATCH_IMPORT_COMMIT: "Chốt đợt nhập dữ liệu lịch sử",
};

const AUDIT_OBJECT_LABELS: Record<string, string> = {
  reports: "Báo cáo thôn",
  report_values: "Chỉ tiêu báo cáo",
  report_validation_flags: "Kết quả kiểm tra dữ liệu",
  report_periods: "Kỳ báo cáo",
  report_period_change_requests: "Yêu cầu thay đổi kỳ báo cáo",
  report_period_change_decisions: "Quyết định thay đổi kỳ báo cáo",
  pending_updates: "Kiến nghị đối chiếu số liệu",
  profiles: "Tài khoản cán bộ",
  ai_action_drafts: "Nội dung hỗ trợ quyết định",
  action_items: "Công việc điều hành",
  legacy_import_batches: "Lô dữ liệu lịch sử",
  report_import_batches: "Đợt nhập dữ liệu lịch sử",
  evacuation_points: "Điểm sơ tán",
  tourism_places: "Điểm du lịch cộng đồng",
  field_cases: "Phản ánh hiện trường",
  notifications: "Thông báo",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || "Thay đổi dữ liệu";
}

export function auditObjectLabel(tableName: string): string {
  return AUDIT_OBJECT_LABELS[tableName] || "Dữ liệu nghiệp vụ";
}
