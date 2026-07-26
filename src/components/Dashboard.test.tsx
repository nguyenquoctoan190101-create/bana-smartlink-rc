import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportData, ReportPeriod } from "../types";
import Dashboard, {
  buildDashboardPeriodOptions,
  filterDashboardReportsByPeriod,
  reportsForDecisionMetrics,
  splitDashboardReports,
} from "./Dashboard";

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
        reports={[report()]}
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

  it("gives leadership a concise decision-first dashboard heading and signal strip", () => {
    render(
      <Dashboard
        reports={[report()]}
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
  });
});
