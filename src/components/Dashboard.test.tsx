import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReportData } from "../types";
import Dashboard, { splitDashboardReports } from "./Dashboard";

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
