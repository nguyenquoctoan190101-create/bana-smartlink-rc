import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(cleanup);

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
                days_delta: -1,
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
                days_delta: 2,
                status: "late",
                dashboard_color: "yellow",
              },
              {
                village_id: "village-3",
                village_name: "Thôn Hòa Ninh",
                old_village_names: [],
                report_id: null,
                submitted_at: null,
                due_date: "2026-07-24",
                days_late: 0,
                days_delta: -3,
                status: "not_submitted",
                dashboard_color: "blue",
              },
              {
                village_id: "village-4",
                village_name: "Thôn Phú Hòa",
                old_village_names: [],
                report_id: null,
                submitted_at: null,
                due_date: "2026-07-16",
                days_late: 5,
                days_delta: 5,
                status: "overdue",
                dashboard_color: "red",
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected path ${path}`);
    });
  });

  it("separates four deadline states and exposes deadline evidence once", async () => {
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
    expect(
      screen.getByRole("heading", { name: "Phạm vi và tổng quan tiến độ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Tiến độ chi tiết theo thôn" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Đã nộp").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Tỷ lệ nộp").parentElement).toHaveTextContent("50%");
    expect(screen.getByText("Quá hạn chưa nộp").parentElement).toHaveTextContent("1");
    const table = screen.getByRole("table", {
      name: /Tiến độ báo cáo theo thôn/,
    });
    expect(within(table).getByText("Hạn nộp")).toBeInTheDocument();
    expect(within(table).getByText("Ngày nộp")).toBeInTheDocument();
    expect(within(table).getByText("Chênh lệch với hạn")).toBeInTheDocument();
    expect(within(table).getByText("Đã nộp đúng hạn")).toBeInTheDocument();
    expect(within(table).getByText("Đã nộp trễ")).toBeInTheDocument();
    expect(within(table).getByText("Chưa nộp, còn hạn")).toBeInTheDocument();
    expect(within(table).getByText("Quá hạn, chưa nộp")).toBeInTheDocument();
    expect(within(table).getByText("Sớm 1 ngày")).toBeInTheDocument();
    expect(within(table).getByText("Muộn 2 ngày")).toBeInTheDocument();
    expect(within(table).getByText("Còn 3 ngày")).toBeInTheDocument();
    expect(within(table).getByText("Quá hạn 5 ngày")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Thôn Phú Hòa");
    const accessibleStatus = within(table)
      .getByText("Đã nộp đúng hạn")
      .closest("td");
    expect(accessibleStatus).toHaveAccessibleName("Đã nộp đúng hạn");
  });

  it("keeps progress visible and does not call ungoverned trend alerts", async () => {
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
                days_delta: -1,
                status: "on_time",
                dashboard_color: "green",
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected path ${path}`);
    });

    render(
      <ProgressDashboard
        periodId="period-current"
        periods={[
          { id: "period-current", name: "Tháng 7/2026", due_date: "2026-07-21" },
          { id: "period-previous", name: "Tháng 6/2026", due_date: "2026-06-21" },
        ]}
      />,
    );

    expect(await screen.findByText("Thôn An Sơn")).toBeInTheDocument();
    expect(
      screen.getByText(/registry chưa có quy tắc so sánh/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Tỷ lệ nộp").parentElement).toHaveTextContent("100%");
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(mocks.apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/reports/trend-alerts"),
      expect.anything(),
    );
  });
});
