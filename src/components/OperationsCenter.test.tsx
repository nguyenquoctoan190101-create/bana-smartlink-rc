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
    expect(screen.getByText(/Không tải được brief chờ duyệt/)).toBeInTheDocument();
    expect(screen.getByText("Chưa tải được brief")).toBeInTheDocument();
    expect(screen.queryByText(/Không tải được dữ liệu điều hành/)).not.toBeInTheDocument();
  });
});
