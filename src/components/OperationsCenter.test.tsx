import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OperationsCenter from "./OperationsCenter";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn(), apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  apiFetch: mocks.apiFetch,
}));

describe("OperationsCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          average_quality_score: 92,
          rule_version: "2026-07-14",
          reports: [{
            report_id: "report-1",
            village_name: "Thôn An Sơn",
            quality_score: 92,
            quality_status: "needs_review",
            unresolved_flag_count: 1,
            outlier_count: 0,
            lineage: { report_source: "manual", report_version: 2 },
          }],
        });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path === "/api/operations/ai-drafts") return Promise.reject(new Error("temporary failure"));
      if (path === "/api/operations/maturity") return Promise.resolve([]);
      if (path === "/api/operations/initiatives") return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  it("keeps successful operational data visible when an optional section fails", async () => {
    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    await waitFor(() => expect(screen.getAllByText("92%")).toHaveLength(2));
    expect(screen.getByText("Thôn An Sơn")).toBeInTheDocument();
    expect(screen.getByText(/Không tải được nội dung điều hành chờ duyệt/)).toBeInTheDocument();
    expect(screen.getByText("Chưa tải được nội dung gợi ý")).toBeInTheDocument();
    expect(screen.queryByText(/Không tải được dữ liệu điều hành/)).not.toBeInTheDocument();
  });

  it("shows Vietnamese status and source labels", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) return Promise.resolve({
        average_quality_score: 100,
        rule_version: "2026-07-14",
        reports: [{ report_id: "report-1", village_name: "Thôn An Sơn", quality_score: 100, quality_status: "ready", unresolved_flag_count: 0, outlier_count: 0, lineage: { report_source: "direct_api", report_version: 2 } }],
      });
      if (path === "/api/operations/ai-drafts") return Promise.resolve([{ id: "draft-1", status: "accepted", content: "Brief mẫu", confidence: 0.9 }]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);
    await waitFor(() => expect(screen.getByText("Đã chấp nhận")).toBeInTheDocument());
    expect(screen.getByText("Đạt")).toBeInTheDocument();
    expect(screen.getByText("API trực tiếp · phiên bản 2")).toBeInTheDocument();
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });
});
