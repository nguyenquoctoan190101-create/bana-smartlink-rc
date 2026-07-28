import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CnscdImpact from "./CnscdImpact";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_reason: unknown, fallback: string) => fallback,
}));

describe("CnscdImpact accessibility", () => {
  it("names the results table and associates village rows with scoped headers", async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        period_id: "period-1",
        period_name: "Tháng 7/2026",
        scope: "assigned_villages",
        scope_village_count: 1,
        has_report_data: true,
        submitted_report_count: 1,
        assisted_report_count: 1,
        ct02_total: 1000,
        ct13_total: 7,
        guided_people_per_1000: 7,
        metric_registry_version: "2026-07-28.1",
        metric_interpretation_limit: "Không dùng để khẳng định tác động.",
        missing_ct02_report_count: 0,
        missing_ct13_report_count: 0,
        zero_ct02_report_count: 0,
        interpretation: "Dữ liệu kiểm thử.",
        villages: [
          {
            village_id: "village-1",
            village_name: "Thôn An Sơn",
            report_id: "report-1",
            assisted_report_count: 1,
            ct02_value: 1000,
            ct13_value: 7,
            guided_people_per_1000: 7,
            data_status: "complete",
            next_action: "view_work_queue",
          },
        ],
      }),
    });

    const { container } = render(
      <CnscdImpact selectedPeriod="period-1" />,
    );

    const table = await screen.findByRole("table", {
      name: "Kết quả hỗ trợ, CT02, CT13 và tỷ lệ trên 1.000 dân theo từng thôn",
    });
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(8);
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(1);
    expect(
      screen.getByRole("region", {
        name: (
          "Bảng kết quả hỗ trợ theo thôn; có thể cuộn ngang trên màn hình nhỏ"
        ),
      }),
    ).toHaveAttribute("tabindex", "0");

    const result = await axe.run(container, {
      // jsdom does not implement the canvas API axe uses for contrast.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("shows assigned scope, data readiness and a concrete CNSCĐ action", async () => {
    const onNavigate = vi.fn();
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        period_id: "period-1",
        period_name: "Tháng 7/2026",
        scope: "assigned_villages",
        scope_village_count: 1,
        has_report_data: true,
        submitted_report_count: 1,
        assisted_report_count: 0,
        ct02_total: 800,
        ct13_total: null,
        guided_people_per_1000: null,
        metric_registry_version: "2026-07-28.1",
        metric_interpretation_limit: "Không dùng để khẳng định tác động.",
        missing_ct02_report_count: 0,
        missing_ct13_report_count: 1,
        zero_ct02_report_count: 0,
        interpretation: "Cần bổ sung CT13.",
        villages: [
          {
            village_id: "village-1",
            village_name: "Thôn An Sơn",
            report_id: "report-1",
            assisted_report_count: 0,
            ct02_value: 800,
            ct13_value: null,
            guided_people_per_1000: null,
            data_status: "incomplete",
            next_action: "complete_report",
          },
        ],
      }),
    });

    const { container } = render(
      <CnscdImpact
        selectedPeriod="period-1"
        role="to_cnscd"
        onNavigate={onNavigate}
      />,
    );
    const view = within(container);

    expect(await view.findByText(/Phạm vi: 1 thôn được phân công/)).toBeInTheDocument();
    const row = view.getByRole("row", { name: /Thôn An Sơn/ });
    expect(within(row).getByText("800")).toBeInTheDocument();
    expect(
      within(row).getByText("Đã có báo cáo, thiếu CT02/CT13"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(row).getByRole("button", { name: "Bổ sung CT02/CT13" }),
    );
    expect(onNavigate).toHaveBeenCalledWith("report-form");
  });
});
