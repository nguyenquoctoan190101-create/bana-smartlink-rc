import { render, screen, waitFor, within } from "@testing-library/react";
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
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      if (path === "/api/operations/ai-drafts") return Promise.reject(new Error("temporary failure"));
      if (path === "/api/operations/maturity") return Promise.resolve([]);
      if (path === "/api/operations/initiatives") return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  it("keeps successful operational data visible when an optional section fails", async () => {
    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    await waitFor(() => expect(screen.getAllByText("92%")).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "Ưu tiên điều hành" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hàng việc cần xử lý" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dữ liệu cần rà soát" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nội dung hỗ trợ quyết định" })).toBeInTheDocument();
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
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);
    await waitFor(() => expect(screen.getByText("Đã chấp nhận")).toBeInTheDocument());
    expect(screen.getByText("Đạt")).toBeInTheDocument();
    expect(screen.getByText("API trực tiếp · phiên bản 2")).toBeInTheDocument();
    expect(screen.queryByText("accepted")).not.toBeInTheDocument();
    expect(screen.queryByText("ready")).not.toBeInTheDocument();
  });

  it("keeps leadership evidence approved and scoped to the selected period", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          rule_version: "2026-07-14",
          reports: [
            {
              report_id: "approved-report",
              village_name: "Thôn đã duyệt",
              workflow_status: "approved",
              quality_score: 96,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 2 },
            },
            {
              report_id: "submitted-report",
              village_name: "Thôn đang bổ sung",
              workflow_status: "needs_revision",
              quality_score: 40,
              quality_status: "needs_review",
              unresolved_flag_count: 2,
              outlier_count: 1,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "current-draft",
            period_id: "period-1",
            status: "accepted",
            content: "Nội dung đúng kỳ",
            confidence: 0.9,
          },
          {
            id: "other-draft",
            period_id: "period-2",
            status: "accepted",
            content: "Nội dung kỳ khác",
            confidence: 0.8,
          },
        ]);
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="lanh_dao" />);

    expect(await screen.findByText("Thôn đã duyệt")).toBeInTheDocument();
    expect(screen.queryByText("Thôn đang bổ sung")).not.toBeInTheDocument();
    expect(screen.getByText("Nội dung đúng kỳ")).toBeInTheDocument();
    expect(screen.queryByText("Nội dung kỳ khác")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("1 báo cáo trong phạm vi quyết định").length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["can_bo_thon", "Bức tranh công việc của thôn"],
    ["to_cnscd", "Bức tranh công việc hỗ trợ"],
  ] as const)("labels the overview for the %s role without exposing internal support content", async (role, heading) => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({ reports: [] });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { container } = render(<OperationsCenter periodId="period-1" role={role} />);
    const view = within(container);

    expect(await view.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Hàng việc cần xử lý" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Dữ liệu cần rà soát" })).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Nội dung hỗ trợ quyết định" })).not.toBeInTheDocument();
  });
});
