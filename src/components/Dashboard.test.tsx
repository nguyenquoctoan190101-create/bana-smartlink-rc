import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReportData, ReportPeriod } from "../types";
import Dashboard, {
  buildDashboardPeriodOptions,
  filterDashboardReportsByPeriod,
  splitDashboardReports,
} from "./Dashboard";

vi.mock("../lib/AuthContext", () => ({
  useAuth: () => ({ userVillageId: null }),
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({ villages: [{ id: "village-1", name: "Thôn An Sơn" }] }),
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
    expect(onDeleteReport).toHaveBeenCalledWith("report-1", true);
  });
});
