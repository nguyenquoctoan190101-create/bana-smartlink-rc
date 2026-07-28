import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
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
          period: { id: "period-1", name: "Tháng 7/2026" },
          rule_version: "2026-07-14",
          reports: [{
            report_id: "report-1",
            village_name: "Thôn An Sơn",
            completeness_percent: 92.9,
            completeness_numerator: 13,
            completeness_denominator: 14,
            validity_percent: 100,
            blocking_flag_count: 0,
            timeliness_percent: 100,
            timeliness_status: "on_time",
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
    const { container } = render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    await waitFor(() => expect(screen.getAllByText(/92\.9%/)).toHaveLength(2));
    expect(screen.getByText("13/14 trường · 1 báo cáo chưa đủ")).toBeInTheDocument();
    expect(screen.getByText("1/1 báo cáo · 0 có lỗi chặn")).toBeInTheDocument();
    expect(screen.getByText("1/1 báo cáo · 0 không đúng hạn")).toBeInTheDocument();
    expect(screen.queryByText("Điểm chất lượng")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ưu tiên điều hành" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hàng việc cần xử lý" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dữ liệu cần rà soát" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nội dung hỗ trợ quyết định" })).toBeInTheDocument();
    expect(screen.getByText("Thôn An Sơn")).toBeInTheDocument();
    expect(screen.getByText(/Không tải được bản tóm tắt hỗ trợ quyết định/)).toBeInTheDocument();
    expect(screen.getByText("Chưa tải được bản tóm tắt")).toBeInTheDocument();
    expect(screen.queryByText(/Không tải được dữ liệu điều hành/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tạo bản phân tích có căn cứ" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Chưa bật — thiếu quy tắc đã phê duyệt"),
    ).toBeInTheDocument();
    expect(mocks.apiJson).not.toHaveBeenCalledWith(
      expect.stringContaining("/reports/trend-alerts"),
    );
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("shows Vietnamese status and source labels", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) return Promise.resolve({
        period: { id: "period-1", name: "Tháng 7/2026" },
        rule_version: "2026-07-14",
        reports: [{ report_id: "report-1", village_name: "Thôn An Sơn", completeness_percent: 100, completeness_numerator: 14, completeness_denominator: 14, validity_percent: 100, blocking_flag_count: 0, timeliness_percent: 100, timeliness_status: "on_time", quality_status: "ready", unresolved_flag_count: 0, outlier_count: 0, lineage: { report_source: "direct_api", report_version: 2 } }],
      });
      if (path === "/api/operations/ai-drafts") return Promise.resolve([{ id: "draft-1", period_id: "period-1", status: "accepted", content: "Brief mẫu", confidence: 0.9, review_notes: "Đã đối chiếu đầy đủ tài liệu nguồn.", reviewed_at: "2026-07-28T12:00:00+07:00" }]);
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
          period: { id: "period-1", name: "Tháng 7/2026" },
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
            created_at: "2026-07-26T12:00:00+07:00",
            review_notes: "Đã đối chiếu đầy đủ căn cứ nguồn.",
            reviewed_at: "2026-07-26T13:00:00+07:00",
          },
          {
            id: "legacy-invalid-accepted",
            period_id: "period-1",
            status: "accepted",
            content: "Nội dung accepted di sản thiếu căn cứ duyệt",
            confidence: 0.99,
            created_at: "2026-07-29T12:00:00+07:00",
          },
          {
            id: "pending-current-draft",
            period_id: "period-1",
            status: "pending_review",
            content: "Nội dung chờ duyệt không dành cho lãnh đạo",
            confidence: 0.95,
            created_at: "2026-07-28T12:00:00+07:00",
          },
          {
            id: "rejected-current-draft",
            period_id: "period-1",
            status: "rejected",
            content: "Nội dung đã từ chối không dành cho lãnh đạo",
            confidence: 0.7,
            created_at: "2026-07-27T12:00:00+07:00",
          },
          {
            id: "other-draft",
            period_id: "period-2",
            status: "accepted",
            content: "Nội dung kỳ khác",
            confidence: 0.8,
          },
          {
            id: "orphan-draft",
            period_id: null,
            status: "accepted",
            content: "Nội dung không gắn kỳ",
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
    const acceptedDraftMetric = screen
      .getByText("Bản tóm tắt đã duyệt")
      .closest("article");
    expect(acceptedDraftMetric).not.toBeNull();
    expect(within(acceptedDraftMetric as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(
      screen.getByText("Chỉ tính hồ sơ đã được quản trị xã chấp nhận"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/bản mới đang chờ quản trị xã thẩm định/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nội dung chờ duyệt không dành cho lãnh đạo"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nội dung đã từ chối không dành cho lãnh đạo"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nội dung accepted di sản thiếu căn cứ duyệt"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Nội dung kỳ khác")).not.toBeInTheDocument();
    expect(screen.queryByText("Nội dung không gắn kỳ")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("1 báo cáo trong phạm vi quyết định").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Tạo bản phân tích có căn cứ/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Căn cứ nhận xét/),
    ).not.toBeInTheDocument();
  });

  it("keeps a legacy accepted draft without review evidence out of the official brief", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "approved-report",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 94,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "legacy-invalid-accepted",
            period_id: "period-1",
            status: "accepted",
            content: "Nội dung di sản chỉ được giữ để truy vết.",
            created_at: "2026-07-28T12:00:00+07:00",
            review_notes: "   ",
            reviewed_at: null,
          },
        ]);
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      if (path === "/api/operations/initiatives") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    expect(
      await screen.findByText("Chưa có hồ sơ được chấp nhận hợp lệ"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Hồ sơ đã được chấp nhận gần nhất"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Hồ sơ lịch sử thiếu căn cứ duyệt; không dùng làm căn cứ chính thức",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Thiếu căn cứ duyệt")).toBeInTheDocument();
    expect(
      screen.getByText("Nội dung di sản chỉ được giữ để truy vết."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lịch sử hồ sơ hỗ trợ quyết định (1)"),
    ).toBeInTheDocument();
  });

  it("turns the latest draft into an evidence-backed review brief and records reviewer notes", async () => {
    const user = userEvent.setup();
    const content = [
      "Kết luận: Cần rà soát 1 báo cáo trước khi sử dụng.",
      "Mức ưu tiên: Cao",
      "Hành động đề xuất: Đối chiếu cảnh báo với tài liệu nguồn.",
      "Căn cứ: 1 báo cáo đã duyệt; đầy đủ 13/14 trường; hợp lệ 1/1; đúng hạn 1/1.",
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
              completeness_percent: 92.9,
              completeness_numerator: 13,
              completeness_denominator: 14,
              validity_percent: 100,
              blocking_flag_count: 0,
              timeliness_percent: 100,
              timeliness_status: "on_time",
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
                completeness_percent: 92.9,
                completeness_numerator: 13,
                completeness_denominator: 14,
                validity_percent: 100,
                blocking_flag_count: 0,
                timeliness_percent: 100,
                timeliness_status: "on_time",
                unresolved_flag_count: 1,
                report_source: "excel",
                report_version: 3,
                rule_version: "2026-07-14",
              },
              {
                kind: "decision_metrics",
                id: "period:Tháng 7/2026",
                label: "Bằng chứng chất lượng dùng để tạo bản tóm tắt",
                report_count: 1,
                ready_report_count: 0,
                complete_field_count: 13,
                expected_field_count: 14,
                completeness_percent: 92.9,
                valid_report_count: 1,
                timely_report_count: 1,
                blocked_report_count: 0,
                review_report_count: 1,
                late_report_count: 0,
                open_action_count: 0,
                overdue_action_count: 0,
                generator_version: "deterministic-evidence-v3",
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
        return Promise.resolve({
          id: "draft-pending",
          period_id: "period-1",
          status: "accepted",
          content,
          confidence: 0.82,
          review_notes: "Đã đối chiếu đủ tài liệu nguồn.",
          reviewed_at: "2026-07-28T13:00:00+07:00",
        });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    expect(await screen.findByText("Kết luận cần xem xét")).toBeInTheDocument();
    expect(screen.getByText("Cần rà soát 1 báo cáo trước khi sử dụng.")).toBeInTheDocument();
    expect(screen.getByText("Đối chiếu cảnh báo với tài liệu nguồn.")).toBeInTheDocument();
    expect(screen.getByText("AI phân tích trên gói căn cứ đã giới hạn")).toBeInTheDocument();
    expect(screen.getByText("Nhận định để tham khảo")).toBeInTheDocument();
    expect(screen.getByText("Rà soát theo nhóm cảnh báo")).toBeInTheDocument();
    expect(
      screen.getAllByText("Đánh đổi cần chấp nhận").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Rủi ro và cách giảm thiểu")).toBeInTheDocument();
    expect(screen.getByText("Câu hỏi phản biện trước khi duyệt")).toBeInTheDocument();
    expect(screen.getAllByText("Thôn An Sơn").length).toBeGreaterThan(0);
    expect(screen.getByText("Căn cứ có thể truy ngược")).toBeInTheDocument();
    expect(
      screen.getByText("Lịch sử hồ sơ hỗ trợ quyết định (1)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đang chờ duyệt" })).toBeDisabled();

    const aiDisclosure = screen
      .getByText("Phân tích AI tham khảo")
      .closest("details");
    expect(aiDisclosure).toBeInstanceOf(HTMLDetailsElement);
    expect(aiDisclosure).not.toHaveAttribute("open");
    await user.click(screen.getByText("Phân tích AI tham khảo"));
    expect(aiDisclosure).toHaveAttribute("open");

    const evidenceDisclosure = document.getElementById(
      "decision-evidence-list-draft-pending",
    );
    expect(evidenceDisclosure).toBeInstanceOf(HTMLDetailsElement);
    expect(evidenceDisclosure).not.toHaveAttribute("open");
    const riskSection = screen
      .getByText("Rủi ro và cách giảm thiểu")
      .closest("section");
    if (!riskSection) throw new Error("Không tìm thấy vùng rủi ro AI");
    await user.click(
      within(riskSection).getByRole("button", {
        name: /Mở căn cứ Thôn An Sơn \(report-1\)/,
      }),
    );
    expect(evidenceDisclosure).toHaveAttribute("open");

    const acceptButton = screen.getByRole("button", {
      name: "Chấp nhận làm tài liệu tham khảo",
    });
    expect(acceptButton).toBeDisabled();
    await user.type(
      screen.getByLabelText("Căn cứ nhận xét"),
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
    expect(
      await screen.findByText("Đã chấp nhận"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nhận xét đã lưu")).toBeInTheDocument();
    expect(
      screen.getByText("Đã đối chiếu đủ tài liệu nguồn."),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Căn cứ nhận xét"),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("does not fabricate a review result when the server response violates the draft contract", async () => {
    const user = userEvent.setup();
    const content = [
      "Kết luận: Cần tiếp tục đối chiếu dữ liệu nguồn.",
      "Mức ưu tiên: Cao",
      "Hành động đề xuất: Kiểm tra lại báo cáo trước khi quyết định.",
      "Căn cứ: 1 báo cáo đã duyệt.",
      "Giới hạn: Không tự động phê duyệt.",
    ].join("\n");
    let draftListCalls = 0;
    mocks.apiJson.mockImplementation((path: string, options?: RequestInit) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "report-1",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 90,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts" && !options?.method) {
        draftListCalls += 1;
        return Promise.resolve([
          {
            id: "draft-pending",
            period_id: "period-1",
            status: "pending_review",
            content,
            created_at: "2026-07-28T12:00:00+07:00",
          },
        ]);
      }
      if (
        path === "/api/operations/ai-drafts/draft-pending/review" &&
        options?.method === "POST"
      ) {
        return Promise.resolve({
          id: "draft-pending",
          period_id: "period-1",
          status: "accepted",
          content,
          review_notes: "Nhận xét khác với nội dung vừa gửi.",
          reviewed_at: "2026-07-28T13:00:00+07:00",
        });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      if (path === "/api/operations/initiatives") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);
    await user.type(
      await screen.findByLabelText("Căn cứ nhận xét"),
      "Đã kiểm tra đúng tài liệu nguồn.",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Chấp nhận làm tài liệu tham khảo",
      }),
    );

    expect(
      await screen.findByText(
        "Phản hồi duyệt không hợp lệ nên hệ thống đã tải lại dữ liệu nguồn. Hãy kiểm tra trạng thái trước khi thao tác tiếp.",
      ),
    ).toBeInTheDocument();
    expect(draftListCalls).toBe(2);
    expect(screen.getByText("Chờ duyệt")).toBeInTheDocument();
    expect(screen.queryByText("Đã chấp nhận")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Căn cứ nhận xét")).toHaveValue(
      "Đã kiểm tra đúng tài liệu nguồn.",
    );
  }, 10_000);

  it("ignores an older refresh after the selected period and role change", async () => {
    let resolveOldQuality: (value: unknown) => void = () => undefined;
    const oldQuality = new Promise<unknown>((resolve) => {
      resolveOldQuality = resolve;
    });
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.includes("/api/operations/quality?period_id=period-1")) {
        return oldQuality;
      }
      if (path.includes("/api/operations/quality?period_id=period-2")) {
        return Promise.resolve({
          period: { id: "period-2", name: "Tháng 8/2026" },
          reports: [
            {
              report_id: "new-report",
              village_name: "Thôn kỳ mới",
              workflow_status: "approved",
              quality_score: 96,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 2 },
            },
          ],
        });
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path === "/api/operations/ai-drafts") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      if (path === "/api/operations/initiatives") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const view = render(
      <OperationsCenter periodId="period-1" role="admin_xa" />,
    );
    view.rerender(
      <OperationsCenter periodId="period-2" role="lanh_dao" />,
    );

    expect(await screen.findByText("Thôn kỳ mới")).toBeInTheDocument();
    await act(async () => {
      resolveOldQuality({
        period: { id: "period-1", name: "Tháng 7/2026" },
        reports: [
          {
            report_id: "old-report",
            village_name: "Thôn kỳ cũ",
            workflow_status: "approved",
            quality_score: 71,
            quality_status: "needs_review",
            unresolved_flag_count: 1,
            outlier_count: 0,
            lineage: { report_source: "manual", report_version: 1 },
          },
        ],
      });
      await oldQuality;
    });

    expect(screen.getByText("Thôn kỳ mới")).toBeInTheDocument();
    expect(screen.queryByText("Thôn kỳ cũ")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tháng 8/2026").length).toBeGreaterThan(0);
  });

  it("hides malformed AI analysis and keeps the deterministic brief usable", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "report-1",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 91,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "malformed-ai-draft",
            period_id: "period-1",
            status: "accepted",
            content: [
              "Kết luận: Kết luận xác định vẫn phải hiển thị.",
              "Mức ưu tiên: Thông thường",
              "Hành động đề xuất: Đối chiếu căn cứ trước khi quyết định.",
              "Căn cứ: 1 báo cáo đã duyệt.",
              "Giới hạn: Không tự động phê duyệt.",
            ].join("\n"),
            created_at: "2026-07-28T12:00:00+07:00",
            review_notes: "Đã đối chiếu đầy đủ căn cứ nguồn.",
            reviewed_at: "2026-07-28T13:00:00+07:00",
            citations: [
              {
                kind: "quality_snapshot",
                id: { unsafe: "report-1" },
                village_name: ["Thôn An Sơn"],
                quality_score: Number.NaN,
              },
              {
                kind: "ai_generation",
                label: { unsafe: "Không được render object" },
              },
              {
                kind: "ai_enrichment",
                id: "decision-ai-analysis",
                analysis: {
                  executive_assessment:
                    "Nội dung AI sai cấu trúc tuyệt đối không được hiển thị.",
                  recommended_option_id: "A",
                  options: null,
                  risks: [],
                  reviewer_questions: [],
                  assumptions: [],
                },
              },
            ],
          },
        ]);
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    expect(
      await screen.findByText("Kết luận xác định vẫn phải hiển thị."),
    ).toBeInTheDocument();
    expect(screen.getByText("Bản an toàn bằng luật xác định")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Phần AI có cấu trúc không hợp lệ nên đã được ẩn. Kết luận và căn cứ xác định vẫn giữ nguyên để người có thẩm quyền rà soát.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Nội dung AI sai cấu trúc tuyệt đối không được hiển thị.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Phân tích AI tham khảo")).not.toBeInTheDocument();
  });

  it("keeps the latest rejected admin draft visible without inventing legacy metrics", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "report-1",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 90,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "rejected-only",
            period_id: "period-1",
            status: "rejected",
            content: "Bản bị từ chối vẫn cần truy vết.",
            created_at: "2026-07-28T12:00:00+07:00",
            review_notes: "Cần bổ sung tài liệu nguồn trước khi tạo lại.",
            reviewed_at: "2026-07-28T13:00:00+07:00",
            citations: [
              {
                kind: "quality_snapshot",
                id: "legacy-report",
                village_name: "Thôn An Sơn",
              },
            ],
          },
        ]);
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const { container } = render(
      <OperationsCenter periodId="period-1" role="admin_xa" />,
    );

    expect(
      await screen.findByText("Bản bị từ chối vẫn cần truy vết."),
    ).toBeInTheDocument();
    expect(screen.getByText("Hồ sơ đã bị từ chối gần nhất")).toBeInTheDocument();
    expect(screen.getByText("Đã từ chối")).toBeInTheDocument();
    const evidenceSummary = container.querySelector(
      ".decision-evidence-summary",
    );
    expect(evidenceSummary).not.toBeNull();
    expect(
      Array.from(evidenceSummary?.querySelectorAll("dd") || []).map(
        (item) => item.textContent,
      ),
    ).toEqual(["—", "—", "—", "—"]);
    expect(
      screen.getByRole("button", { name: "Tạo bản phân tích có căn cứ" }),
    ).toBeEnabled();
  });

  it("flags the latest rejected legacy draft when review evidence is incomplete", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({
          period: { id: "period-1", name: "Tháng 7/2026" },
          reports: [
            {
              report_id: "report-1",
              village_name: "Thôn An Sơn",
              workflow_status: "approved",
              quality_score: 90,
              quality_status: "ready",
              unresolved_flag_count: 0,
              outlier_count: 0,
              lineage: { report_source: "manual", report_version: 1 },
            },
          ],
        });
      }
      if (path === "/api/operations/ai-drafts") {
        return Promise.resolve([
          {
            id: "legacy-rejected-without-review-note",
            period_id: "period-1",
            status: "rejected",
            content: "Bản từ chối di sản thiếu căn cứ duyệt.",
            created_at: "2026-07-28T12:00:00+07:00",
            reviewed_at: "2026-07-28T13:00:00+07:00",
          },
        ]);
      }
      if (path === "/api/operations/actions") return Promise.resolve([]);
      if (path.startsWith("/reports/trend-alerts")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<OperationsCenter periodId="period-1" role="admin_xa" />);

    expect(
      await screen.findByText("Bản từ chối di sản thiếu căn cứ duyệt."),
    ).toBeInTheDocument();
    expect(screen.getByText("Thiếu căn cứ duyệt")).toBeInTheDocument();
    expect(screen.queryByText("Đã từ chối")).not.toBeInTheDocument();
    expect(screen.getByText("Cảnh báo kiểm toán")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hồ sơ lịch sử thiếu căn cứ duyệt; không dùng làm căn cứ chính thức",
      ),
    ).toHaveAttribute("role", "note");
  });

  it("orders the action queue and renders its accountability contract", async () => {
    mocks.apiJson.mockImplementation((path: string) => {
      if (path.startsWith("/api/operations/quality")) {
        return Promise.resolve({ reports: [] });
      }
      if (path === "/api/operations/actions") {
        return Promise.resolve([
          {
            id: "action-upcoming",
            source_type: "trend_alert",
            title: "Việc sắp đến hạn",
            priority: "critical",
            status: "pending",
            owner_id: null,
            owner_name: null,
            owner_label: "Chưa phân công",
            due_date: "2026-07-31",
            due_state: "upcoming",
            created_at: "2026-07-28T09:00:00+07:00",
            age_days: 1,
            evidence_status: "linked",
            can_update: false,
            next_action: null,
          },
          {
            id: "action-overdue",
            source_type: "proposal",
            title: "Việc quá hạn",
            priority: "high",
            status: "pending",
            owner_id: "owner-1",
            owner_name: "Nguyễn Văn An",
            owner_label: "Nguyễn Văn An",
            due_date: "2026-07-27",
            due_state: "overdue",
            created_at: "2026-07-24T20:00:00Z",
            age_days: 4,
            evidence_status: "missing",
            can_update: true,
            next_action: "start",
          },
          {
            id: "action-today",
            source_type: "manual",
            title: "Việc đến hạn hôm nay",
            priority: "normal",
            status: "in_progress",
            owner_id: "owner-2",
            owner_name: "Trần Thị Bình",
            owner_label: "Trần Thị Bình",
            due_date: "2026-07-29",
            due_state: "due_today",
            created_at: "2026-07-25T23:30:00+07:00",
            age_days: 3,
            evidence_status: "manual",
            can_update: false,
            next_action: null,
          },
          {
            id: "malformed-action",
            title: "Không được hiển thị",
            priority: "urgent",
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const { container } = render(
      <OperationsCenter periodId="period-1" role="can_bo_thon" />,
    );
    await screen.findByRole("heading", { name: "Việc quá hạn" });
    const queue = container.querySelector("#operations-tasks");
    expect(queue).not.toBeNull();
    const queueView = within(queue as HTMLElement);

    expect(
      await queueView.findByRole("heading", { name: "Việc quá hạn" }),
    ).toBeInTheDocument();
    expect(
      queueView.getAllByRole("heading", { level: 3 }).map((item) => item.textContent),
    ).toEqual([
      "Việc quá hạn",
      "Việc đến hạn hôm nay",
      "Việc sắp đến hạn",
    ]);
    expect(queueView.getByText(/Phụ trách: Nguyễn Văn An/)).toHaveTextContent(
      "Ưu tiên cao · Tuổi việc 4 ngày · quá hạn 27/7/2026 · Căn cứ: thiếu căn cứ liên kết · Nguồn: Đề xuất",
    );
    expect(queueView.getByText(/Phụ trách: Trần Thị Bình/)).toHaveTextContent(
      "đến hạn hôm nay 29/7/2026",
    );
    expect(queueView.getByText(/Phụ trách: Chưa phân công/)).toHaveTextContent(
      "Căn cứ: có căn cứ liên kết · Nguồn: Cảnh báo xu hướng",
    );
    expect(
      queueView.getByRole("button", { name: "Nhận việc" }),
    ).toBeInTheDocument();
    expect(queueView.queryByRole("button", { name: "Hoàn tất" })).not.toBeInTheDocument();
    expect(queueView.queryByText("Không được hiển thị")).not.toBeInTheDocument();
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
