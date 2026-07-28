import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OperationsCenter from "./OperationsCenter";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn(), apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

describe("OperationsCenter", () => {
  afterEach(() => cleanup());

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
    expect(screen.getByText(/Không tải được bản tóm tắt hỗ trợ quyết định/)).toBeInTheDocument();
    expect(screen.getByText("Chưa tải được bản tóm tắt")).toBeInTheDocument();
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
    expect(
      screen.getByRole("button", { name: "Tạo phân tích AI có căn cứ" }),
    ).toBeEnabled();
  });

  it("turns the latest draft into an evidence-backed review brief and records reviewer notes", async () => {
    const user = userEvent.setup();
    const content = [
      "Kết luận: Cần rà soát 1 báo cáo trước khi sử dụng.",
      "Mức ưu tiên: Cao",
      "Hành động đề xuất: Đối chiếu cảnh báo với tài liệu nguồn.",
      "Căn cứ: 2 báo cáo đã duyệt; điểm trung bình 88%.",
      "Giới hạn: Không tự phê duyệt, giao việc hoặc công bố.",
    ].join("\n");
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "report-1",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 88,
              quality_status: "needs_review",
              unresolved_flag_count: 1,
              outlier_count: 0,
              lineage: { report_source: "excel", report_version: 3 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "draft-pending",
            period_id: "period-1",
            status: "pending_review",
            content,
            confidence: 0.82,
            model_provider: "openai-responses:gpt-5.6-sol",
            created_at: "2026-07-28T12:00:00+07:00",
            citations: [
              {
                kind: "quality_snapshot",
                id: "report-1",
                village_name: "Thôn An Sơn",
                quality_score: 88,
                unresolved_flag_count: 1,
                report_source: "excel",
                report_version: 3,
                rule_version: "2026-07-14",
              },
              {
                kind: "decision_metrics",
                id: "period:Tháng 7/2026",
                label: "Chỉ số tổng hợp dùng để tạo bản tóm tắt",
              },
              {
                kind: "ai_enrichment",
                id: "decision-ai-analysis",
                status: "grounded",
                model: "gpt-5.6-sol",
                prompt_version: "decision-copilot-v1",
                analysis: {
                  executive_assessment:
                    "Cần rà soát nguồn và trách nhiệm xử lý trước khi mở rộng sử dụng.",
                  recommended_option_id: "A",
                  options: [
                    {
                      id: "A",
                      title: "Rà soát theo nhóm cảnh báo",
                      rationale:
                        "Tập trung vào căn cứ cần xem lại và giữ được dấu vết kiểm tra.",
                      tradeoff: "Cần thêm thời gian đối chiếu thủ công.",
                      urgency: "ngay",
                      evidence_ids: ["report-1"],
                    },
                    {
                      id: "B",
                      title: "Theo dõi rồi đánh giá lại",
                      rationale:
                        "Giữ nhịp vận hành và chờ thêm căn cứ trước khi thay đổi.",
                      tradeoff: "Có thể làm chậm việc xử lý cảnh báo.",
                      urgency: "theo_doi",
                      evidence_ids: ["period:Tháng 7/2026"],
                    },
                  ],
                  risks: [
                    {
                      title: "Bỏ sót căn cứ nguồn",
                      severity: "cao",
                      mitigation:
                        "Yêu cầu người duyệt mở bản nguồn và lưu nhận xét đối chiếu.",
                      evidence_ids: ["report-1"],
                    },
                  ],
                  reviewer_questions: [
                    "Nguồn báo cáo đã được đối chiếu độc lập hay chưa?",
                  ],
                  assumptions: [
                    "Trạng thái báo cáo là trạng thái mới nhất.",
                  ],
                },
              },
            ],
          },
          {
            id: "draft-history",
            period_id: "period-1",
            status: "rejected",
            content: "Bản cũ đã bị từ chối.",
            created_at: "2026-07-27T12:00:00+07:00",
            review_notes: "Cần bổ sung nguồn đối chiếu.",
          },
        ]);
      }
      if (
        path === "/api/operations/ai-drafts/draft-pending/review" &&
        options?.method === "POST"
      ) {
        return Promise.resolve({ status: "accepted" });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    expect(await screen.findByText("Kết luận đề xuất")).toBeInTheDocument();
    expect(screen.getByText("Cần rà soát 1 báo cáo trước khi sử dụng.")).toBeInTheDocument();
    expect(screen.getByText("Đối chiếu cảnh báo với tài liệu nguồn.")).toBeInTheDocument();
    expect(screen.getByText("Độ sẵn sàng căn cứ 82%")).toBeInTheDocument();
    expect(screen.getByText("AI tăng cường · đã kiểm tra dẫn chứng")).toBeInTheDocument();
    expect(screen.getByText("Nhận định điều hành")).toBeInTheDocument();
    expect(screen.getByText("Rà soát theo nhóm cảnh báo")).toBeInTheDocument();
    expect(
      screen.getAllByText("Đánh đổi cần chấp nhận").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Rủi ro và cách giảm thiểu")).toBeInTheDocument();
    expect(screen.getByText("Câu hỏi phản biện trước khi duyệt")).toBeInTheDocument();
    expect(screen.getAllByText("Thôn An Sơn").length).toBeGreaterThan(0);
    expect(screen.getByText("Xem 1 căn cứ báo cáo")).toBeInTheDocument();
    expect(screen.getByText("Lịch sử bản tóm tắt (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đang chờ duyệt" })).toBeDisabled();

    const acceptButton = screen.getByRole("button", {
      name: "Chấp nhận và lưu căn cứ",
    });
    expect(acceptButton).toBeDisabled();
    await user.type(
      screen.getByLabelText("Căn cứ nhận xét của người duyệt"),
      "Đã đối chiếu đủ tài liệu nguồn.",
    );
    expect(acceptButton).toBeEnabled();
    await user.click(acceptButton);

    await waitFor(() =>
      expect(mocks.apiJson).toHaveBeenCalledWith(
        "/api/operations/ai-drafts/draft-pending/review",
        {
          method: "POST",
          body: JSON.stringify({
            decision: "accepted",
            notes: "Đã đối chiếu đủ tài liệu nguồn.",
          }),
        },
      ),
    );
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
