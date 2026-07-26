import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProgressDashboard from "./ProgressDashboard";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

const response = (payload: unknown) => ({
  ok: true,
  json: async () => payload,
});

describe("ProgressDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockImplementation((path: string) => {
      if (path.startsWith("/reports/status")) {
        return Promise.resolve(
          response({
            period_id: "period-current",
            villages: [
              {
                village_id: "village-1",
                village_name: "Thôn An Sơn",
                old_village_names: [],
                report_id: "report-1",
                submitted_at: "2026-07-20T08:00:00Z",
                due_date: "2026-07-21",
                days_late: 0,
                status: "on_time",
                dashboard_color: "green",
              },
              {
                village_id: "village-2",
                village_name: "Thôn Hòa Nhơn",
                old_village_names: [],
                report_id: "report-2",
                submitted_at: "2026-07-23T08:00:00Z",
                due_date: "2026-07-21",
                days_late: 2,
                status: "late",
                dashboard_color: "yellow",
              },
              {
                village_id: "village-3",
                village_name: "Thôn Hòa Ninh",
                old_village_names: [],
                report_id: null,
                submitted_at: null,
                due_date: "2026-07-21",
                days_late: 0,
                status: "not_submitted",
                dashboard_color: "red",
              },
            ],
          }),
        );
      }
      if (path === "/reports/periods") {
        return Promise.resolve(
          response([
            { id: "period-current", name: "Tháng 7/2026", due_date: "2026-07-21" },
            { id: "period-previous", name: "Tháng 6/2026", due_date: "2026-06-21" },
          ]),
        );
      }
      if (path.startsWith("/reports/trend-alerts")) {
        return Promise.resolve(response([]));
      }
      throw new Error(`Unexpected path ${path}`);
    });
  });

  it("counts only on-time and late reports as submitted", async () => {
    render(
      <ProgressDashboard
        periodId="period-current"
        periods={[
          { id: "period-current", name: "Tháng 7/2026", due_date: "2026-07-21" },
          { id: "period-previous", name: "Tháng 6/2026", due_date: "2026-06-21" },
        ]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Thôn Hòa Ninh")).toBeInTheDocument(),
    );
    expect(screen.getByText("Đã nộp").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Tỷ lệ nộp").parentElement).toHaveTextContent("67%");
    expect(screen.getAllByText("Đúng hạn").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Trễ hạn").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Chưa nộp")).toBeInTheDocument();
  });
});
