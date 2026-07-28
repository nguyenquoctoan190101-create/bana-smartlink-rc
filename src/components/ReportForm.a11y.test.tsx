import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReportForm from "./ReportForm";

const mocks = vi.hoisted(() => ({
  getLocalDraftForScope: vi.fn(),
  queueReportForSync: vi.fn(),
  saveDraftForScope: vi.fn(),
  syncQueuedReports: vi.fn(),
}));

vi.mock("../lib/AuthContext", () => ({
  useAuth: () => ({
    userName: "Cán bộ thôn",
    userPhone: "0900000000",
    userVillageId: "village-1",
    userVillageIds: ["village-1"],
    userRole: "can_bo_thon",
  }),
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({
    villages: [{ id: "village-1", name: "Thôn An Sơn" }],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../lib/useReportPeriods", () => ({
  useReportPeriods: () => ({
    periods: [
      {
        id: "period-1",
        name: "Tháng 7/2026",
        due_date: "2026-07-31T17:00:00+07:00",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../lib/db", () => ({
  getLocalDraftForScope: mocks.getLocalDraftForScope,
  queueReportForSync: mocks.queueReportForSync,
  saveDraftForScope: mocks.saveDraftForScope,
}));

vi.mock("../lib/reportSync", () => ({
  syncQueuedReports: mocks.syncQueuedReports,
}));

vi.mock("./UploadReport", () => ({
  default: () => <div>Nhập dữ liệu từ tệp báo cáo</div>,
}));

describe("ReportForm accessibility", () => {
  beforeEach(() => {
    mocks.getLocalDraftForScope.mockResolvedValue(null);
    mocks.syncQueuedReports.mockResolvedValue({ accepted: [], rejected: [] });
  });

  it("exposes the task form and all fourteen indicators without blocking axe violations", async () => {
    const { container } = render(
      <ReportForm onSaved={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /báo cáo/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(14);

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });
});
