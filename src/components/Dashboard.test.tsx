import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportPeriod } from "../types";
import Dashboard, {
  buildDashboardPeriodOptions,
  filterDashboardReportsByPeriod,
  reportsForDecisionMetrics,
  splitDashboardReports,
} from "./Dashboard";
import { buildSingleVillageTrend } from "./DashboardInsightCharts";

const authScope = vi.hoisted(() => ({
  userVillageId: null as string | null,
  userVillageIds: [] as string[],
}));

vi.mock("../lib/AuthContext", () => ({
  useAuth: () => authScope,
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({
    villages: [
      { id: "village-1", name: "Thôn An Sơn" },
      { id: "village-2", name: "Thôn Hòa Nhơn" },
      { id: "village-3", name: "Thôn Hòa Ninh" },
    ],
  }),
}));

vi.mock("../lib/apiClient", () => ({
  apiFetch: vi.fn(),
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

const report = (overrides: Partial<ReportData> = {}): ReportData => ({
  id: "report-1",
  village_id: "village-1",
  report_period: "Tháng 7/2026",
  reporter_name: "Cán bộ thôn",
  reporter_phone: "",
  workflow_status: "approved",
  timeliness_status: "on_time",
  publication_status: "published",
  updated_at: "2026-07-20T00:00:00Z",
  CT01: 318,
  CT02: 1176,
  CT03: 10,
  CT04: 20,
  CT05: 3,
  CT06: 4,
  CT07: 100,
  CT08: 2,
  CT09: 286,
  CT10: 700,
  CT11: 1100,
  CT12: 6,
  CT13: 124,
  CT14: 0,
  ...overrides,
});

describe("Dashboard device drafts", () => {
  afterEach(() => {
    cleanup();
    authScope.userVillageId = null;
    authScope.userVillageIds = [];
  });

  it("keeps a device draft separate from the server report with the same id", () => {
    const serverReport = report();
    const localDraft = report({
      local_only: true,
      workflow_status: "draft",
      publication_status: "private",
      CT01: 999,
      updated_at: "2026-07-21T00:00:00Z",
    });

    const result = splitDashboardReports([localDraft, serverReport]);

    expect(result.localDrafts).toEqual([localDraft]);
    expect(result.serverReports).toEqual([serverReport]);
    expect(result.serverReports[0].CT01).toBe(318);
  });

  it("uses only approved or locked reports for leadership metrics", () => {
    const approved = report({ id: "approved", workflow_status: "approved" });
    const locked = report({ id: "locked", workflow_status: "locked" });
    const submitted = report({ id: "submitted", workflow_status: "submitted" });
    const draft = report({ id: "draft", workflow_status: "draft" });

    expect(reportsForDecisionMetrics([draft, submitted, approved, locked])).toEqual([approved, locked]);
  });

  it("keeps duplicate period names separate by UUID", () => {
    const periods: ReportPeriod[] = [
      { id: "period-old", name: "Quý III/2026", due_date: "2026-09-20T17:00:00+07:00" },
      { id: "period-new", name: "Quý III/2026", due_date: "2026-09-30T17:00:00+07:00" },
    ];
    const oldReport = report({ id: "report-old", period_id: "period-old", report_period: "Quý III/2026" });
    const newReport = report({ id: "report-new", period_id: "period-new", report_period: "Quý III/2026" });
    const options = buildDashboardPeriodOptions(periods, [oldReport, newReport]);
    const oldOption = options.find((option) => option.periodId === "period-old");
    const newOption = options.find((option) => option.periodId === "period-new");

    expect(oldOption?.label).not.toBe(newOption?.label);
    expect(filterDashboardReportsByPeriod([oldReport, newReport], periods, oldOption!)).toEqual([oldReport]);
    expect(filterDashboardReportsByPeriod([oldReport, newReport], periods, newOption!)).toEqual([newReport]);
  });

  it("does not attach a legacy name-only row to two periods with the same name", () => {
    const periods: ReportPeriod[] = [
      { id: "period-old", name: "Quý III/2026", due_date: "2026-09-20T17:00:00+07:00" },
      { id: "period-new", name: "Quý III/2026", due_date: "2026-09-30T17:00:00+07:00" },
    ];
    const legacyReport = report({ id: "legacy-report", period_id: undefined, report_period: "Quý III/2026" });
    const selected = buildDashboardPeriodOptions(periods, [legacyReport])
      .find((option) => option.periodId === "period-new");

    expect(filterDashboardReportsByPeriod([legacyReport], periods, selected!)).toEqual([]);
  });

  it("keeps a newly created period selectable before it has reports", () => {
    render(
      <Dashboard
        reports={[]}
        reportPeriods={[{
          id: "period-new",
          name: "Tháng 8/2026",
          due_date: "2026-08-25T17:00:00+07:00",
        }]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
      />,
    );

    expect(screen.getByRole("option", { name: "Tháng 8/2026" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Phạm vi báo cáo và xuất dữ liệu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Số liệu tổng quan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Phân tích ưu tiên theo thôn" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Báo cáo nguồn và hành động nghiệp vụ" }),
    ).toBeInTheDocument();
  });

  it("builds a chronological, de-duplicated trend for one village", () => {
    const periods: ReportPeriod[] = [
      {
        id: "period-1",
        name: "Tháng 6/2026",
        due_date: "2026-06-30T17:00:00+07:00",
      },
      {
        id: "period-2",
        name: "Tháng 7/2026",
        due_date: "2026-07-31T17:00:00+07:00",
      },
    ];
    const olderVersion = report({
      id: "period-1-old",
      period_id: "period-1",
      report_period: "Tháng 6/2026",
      updated_at: "2026-06-20T00:00:00Z",
      CT11: 900,
    });
    const correctedVersion = report({
      id: "period-1-corrected",
      period_id: "period-1",
      report_period: "Tháng 6/2026",
      updated_at: "2026-06-21T00:00:00Z",
      CT11: 1_000,
    });
    const latest = report({
      id: "period-2-report",
      period_id: "period-2",
      report_period: "Tháng 7/2026",
      updated_at: "2026-07-20T00:00:00Z",
      CT11: 1_100,
    });

    const trend = buildSingleVillageTrend(
      [latest, olderVersion, correctedVersion],
      periods,
    );

    expect(trend.map((point) => point.id)).toEqual([
      "period-1-corrected",
      "period-2-report",
    ]);
    expect(trend.map((point) => point.periodLabel)).toEqual([
      "Tháng 6/2026",
      "Tháng 7/2026",
    ]);
  });

  it("opens leadership on a period with approved evidence instead of a newer empty period", async () => {
    render(
      <Dashboard
        reports={[
          report({
            id: "approved-report",
            period_id: "approved-period",
            report_period: "Tháng 7/2026",
            workflow_status: "approved",
          }),
        ]}
        reportPeriods={[
          {
            id: "future-empty",
            name: "1/2027",
            due_date: "2027-01-31T17:00:00+07:00",
          },
          {
            id: "approved-period",
            name: "Tháng 7/2026",
            due_date: "2026-07-31T17:00:00+07:00",
          },
        ]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="lanh_dao"
      />,
    );

    await waitFor(() =>
      expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe(
        "period:approved-period",
      ),
    );
  });

  it("shows where the draft is stored and deletes only the local copy", () => {
    const onDeleteReport = vi.fn();
    const localDraft = report({
      local_only: true,
      workflow_status: "draft",
      publication_status: "private",
      updated_at: "2026-07-21T00:00:00Z",
    });

    render(
      <Dashboard
        reports={[localDraft, report()]}
        onEditReport={vi.fn()}
        onDeleteReport={onDeleteReport}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    expect(screen.getByText("Bản nháp trên thiết bị")).toBeInTheDocument();
    expect(screen.getByText(/Chỉ lưu trong trình duyệt này/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xóa bản nháp/i }));
    expect(onDeleteReport).toHaveBeenCalledWith(localDraft, true);
  });

  it("offers only valid admin workflow transitions for each report state", () => {
    const onApproveReport = vi.fn();
    const onLockReport = vi.fn();
    const onPublishReport = vi.fn();
    const submitted = report({
      workflow_status: "submitted",
      publication_status: "private",
      version: 4,
    });

    const { rerender } = render(
      <Dashboard
        reports={[submitted]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onApproveReport={onApproveReport}
        onLockReport={onLockReport}
        onPublishReport={onPublishReport}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    fireEvent.click(screen.getByTitle("Duyệt báo cáo"));
    expect(onApproveReport).toHaveBeenCalledWith(submitted);
    expect(screen.queryByTitle(/Khóa báo cáo/)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Công bố báo cáo")).not.toBeInTheDocument();

    const approved = report({
      workflow_status: "approved",
      publication_status: "private",
      version: 5,
    });
    rerender(
      <Dashboard
        reports={[approved]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onApproveReport={onApproveReport}
        onLockReport={onLockReport}
        onPublishReport={onPublishReport}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    fireEvent.click(screen.getByTitle(/Khóa báo cáo/));
    fireEvent.click(screen.getByTitle("Công bố báo cáo"));
    expect(onLockReport).toHaveBeenCalledWith(approved);
    expect(onPublishReport).toHaveBeenCalledWith(approved);
    expect(screen.queryByTitle("Xóa báo cáo")).not.toBeInTheDocument();
  });

  it("does not expose internal exports or report creation to citizens", () => {
    render(
      <Dashboard
        reports={[report()]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="dan"
      />,
    );

    expect(screen.queryByText("Lập báo cáo mới")).not.toBeInTheDocument();
    expect(screen.queryByText("Xuất XLSX")).not.toBeInTheDocument();
    expect(screen.queryByText("Xuất DOCX")).not.toBeInTheDocument();
    expect(screen.queryByText("Xuất PDF")).not.toBeInTheDocument();
  });

  it("omits the reporter column because report listings exclude identity fields", () => {
    render(
      <Dashboard
        reports={[report({ reporter_name: "", reporter_phone: "" })]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    expect(screen.queryByRole("columnheader", { name: "Người lập" })).not.toBeInTheDocument();
    expect(screen.queryByText("Chưa ghi nhận")).not.toBeInTheDocument();
  });

  it("associates source-report table headers with their rows and columns", () => {
    render(
      <Dashboard
        reports={[report()]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    const table = screen.getByRole("table", {
      name: "Danh sách báo cáo thuộc phạm vi và bộ lọc hiện tại",
    });
    expect(table.querySelector("caption")).toHaveTextContent(
      "Danh sách báo cáo thuộc phạm vi và bộ lọc hiện tại",
    );
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(8);
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(1);
  });

  it("offers CNSCĐ only the villages in the authenticated assignment ledger", () => {
    authScope.userVillageIds = ["village-1", "village-3"];
    render(
      <Dashboard
        reports={[]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="to_cnscd"
      />,
    );

    expect(
      screen.getByRole("option", { name: "Tất cả 2 thôn được hỗ trợ" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Thôn An Sơn" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Thôn Hòa Ninh" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Thôn Hòa Nhơn" }),
    ).not.toBeInTheDocument();
  });

  it("shows five message-led decision views instead of repeated bars", () => {
    render(
      <Dashboard
        reports={[
          report(),
          report({ id: "report-2", village_id: "village-2" }),
          report({ id: "report-3", village_id: "village-3" }),
        ]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="admin_xa"
      />,
    );

    expect(screen.getByText("Năm góc nhìn để xác định ưu tiên và phân bổ nguồn lực")).toBeInTheDocument();
    expect(screen.getByText(/Bản đồ ưu tiên/i)).toBeInTheDocument();
    expect(screen.getByText(/thôn đầu chiếm khoảng/i)).toBeInTheDocument();
    expect(screen.getByText(/mức tham gia BHYT 95%/i)).toBeInTheDocument();
    expect(screen.getByText(/cường độ hướng dẫn cao nhất/i)).toBeInTheDocument();
    expect(screen.getByText(/trẻ em hoàn cảnh đặc biệt cao nhất/i)).toBeInTheDocument();
  });

  it("opens cross-village priority analysis by default and still allows it to be collapsed", () => {
    render(
      <Dashboard
        reports={[
          report(),
          report({ id: "report-2", village_id: "village-2" }),
        ]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="lanh_dao"
      />,
    );

    const summary = screen
      .getByText("Bộ biểu đồ phân tích chi tiết")
      .closest("summary");
    const disclosure = summary?.closest("details");
    const analysis = screen.getByText(
      "Năm góc nhìn để xác định ưu tiên và phân bổ nguồn lực",
    );

    expect(summary).not.toBeNull();
    expect(disclosure).toHaveAttribute("open");
    expect(analysis).toBeVisible();

    fireEvent.click(summary!);
    expect(disclosure).not.toHaveAttribute("open");
    expect(analysis).not.toBeVisible();

    fireEvent.click(summary!);
    expect(disclosure).toHaveAttribute("open");
    expect(analysis).toBeVisible();
  });

  it("gives leadership a concise decision-first dashboard heading and signal strip", () => {
    render(
      <Dashboard
        reports={[
          report(),
          report({ id: "report-2", village_id: "village-2" }),
        ]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="lanh_dao"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Bức tranh điều hành toàn xã" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Các tín hiệu điều hành nổi bật"),
    ).toHaveTextContent("Phạm vi có căn cứ");
    expect(
      screen.getByLabelText("Các tín hiệu điều hành nổi bật"),
    ).toHaveTextContent("Tập trung an sinh");
    expect(screen.getByLabelText("Kỳ dữ liệu")).toBeInTheDocument();
    expect(screen.getByLabelText("Phạm vi thôn")).toBeInTheDocument();
  });

  it("replaces cross-village ranking with a useful period trend for a one-village role", async () => {
    authScope.userVillageId = "village-1";
    render(
      <Dashboard
        reports={[
          report({
            id: "june-report",
            period_id: "period-june",
            report_period: "Tháng 6/2026",
            updated_at: "2026-06-20T00:00:00Z",
            CT11: 1_050,
          }),
          report({
            id: "july-report",
            period_id: "period-july",
            report_period: "Tháng 7/2026",
            updated_at: "2026-07-20T00:00:00Z",
            CT11: 1_100,
          }),
        ]}
        reportPeriods={[
          {
            id: "period-june",
            name: "Tháng 6/2026",
            due_date: "2026-06-30T17:00:00+07:00",
          },
          {
            id: "period-july",
            name: "Tháng 7/2026",
            due_date: "2026-07-31T17:00:00+07:00",
          },
        ]}
        onEditReport={vi.fn()}
        onDeleteReport={vi.fn()}
        onAddNewReport={vi.fn()}
        userRole="can_bo_thon"
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Theo dõi biến động của thôn",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Diễn biến của Thôn An Sơn qua các kỳ"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Bộ biểu đồ phân tích chi tiết"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Xu hướng qua các kỳ")).toBeInTheDocument();
    expect(screen.queryByText(/thôn đầu chiếm khoảng/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cao nhất/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pareto/i)).not.toBeInTheDocument();
  });
});
