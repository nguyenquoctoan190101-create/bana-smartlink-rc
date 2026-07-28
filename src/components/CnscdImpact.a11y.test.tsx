import { render, screen } from "@testing-library/react";
import axe from "axe-core";
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
        has_report_data: true,
        submitted_report_count: 1,
        assisted_report_count: 1,
        ct13_total: 7,
        missing_ct13_report_count: 0,
        interpretation: "Dữ liệu kiểm thử.",
        villages: [
          {
            village_id: "village-1",
            village_name: "Thôn An Sơn",
            report_id: "report-1",
            assisted_report_count: 1,
            ct13_value: 7,
          },
        ],
      }),
    });

    const { container } = render(
      <CnscdImpact selectedPeriod="period-1" />,
    );

    const table = await screen.findByRole("table", {
      name: "Kết quả hỗ trợ lập báo cáo và CT13 theo từng thôn",
    });
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);
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
});
