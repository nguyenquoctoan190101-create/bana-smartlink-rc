import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type { ReportData, ReportPeriod } from "../types";
import DashboardInsightCharts from "./DashboardInsightCharts";

const report = (overrides: Partial<ReportData> = {}): ReportData => ({
  id: "report-low",
  village_id: "village-low",
  reporter_name: "Cán bộ thôn",
  reporter_phone: "",
  report_period: "Tháng 7/2026",
  workflow_status: "approved",
  timeliness_status: "on_time",
  publication_status: "published",
  updated_at: "2026-07-20T00:00:00Z",
  CT01: 100,
  CT02: 100,
  CT03: 1,
  CT04: 1,
  CT05: 0,
  CT06: 0,
  CT07: 100,
  CT08: 1,
  CT09: 95,
  CT10: 0,
  CT11: 96,
  CT12: 5,
  CT13: 10,
  CT14: 0,
  ...overrides,
});

const villageNames: Record<string, string> = {
  "village-high": "Thôn Mức cao",
  "village-medium": "Thôn Mức trung bình",
  "village-low": "Thôn Mức thấp",
  "village-missing": "Thôn Thiếu dữ liệu",
};

describe("DashboardInsightCharts accessibility", () => {
  it("keeps chart data alternatives semantic and stays neutral without governed targets", async () => {
    const { container } = render(
      <DashboardInsightCharts
        reports={[
          report({
            id: "report-high",
            village_id: "village-high",
            CT03: 15,
            CT04: 0,
            CT09: 70,
            CT11: 80,
            CT13: 10,
          }),
          report({
            id: "report-medium",
            village_id: "village-medium",
            CT03: 7,
            CT04: 0,
            CT09: 85,
            CT11: 92,
            CT13: 60,
          }),
          report({
            id: "report-low",
            village_id: "village-low",
            CT13: 100,
          }),
          report({
            id: "report-missing",
            village_id: "village-missing",
            CT01: null,
            CT02: null,
            CT03: null,
            CT04: null,
            CT07: null,
            CT08: null,
            CT09: null,
            CT11: null,
            CT12: null,
            CT13: null,
          }),
        ]}
        villageName={(id) => villageNames[id] || id}
      />,
    );

    const result = await axe.run(container, {
      // jsdom has no canvas-backed color computation. The missing-data
      // foreground class is asserted explicitly below.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      result.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);

    const heatmap = screen.getByRole("table", {
      name: "Ma trận giá trị mô tả theo thôn",
    });
    expect(heatmap.querySelector("caption")).toHaveTextContent(
      "Giá trị mô tả theo từng chỉ tiêu và từng thôn",
    );
    expect(heatmap.querySelectorAll('thead th[scope="col"]')).toHaveLength(5);
    expect(heatmap.querySelectorAll('tbody th[scope="row"]')).toHaveLength(4);
    expect(within(heatmap).getAllByText("Giá trị mô tả").length).toBeGreaterThan(0);
    expect(
      within(heatmap).getAllByText("Thiếu dữ liệu").length,
    ).toBeGreaterThan(0);
    const missingCellValue = heatmap.querySelector(
      "td > span.text-slate-700",
    );
    expect(missingCellValue).toHaveTextContent("Thiếu dữ liệu");
    expect(within(heatmap).queryByText(/Mức (Cao|Trung bình|Thấp)/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Ma trận giá trị theo thôn; có thể cuộn ngang trên màn hình nhỏ",
      }),
    ).toHaveAttribute("tabindex", "0");
    expect(
      screen.queryByText(/mức tham chiếu 95%/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Biểu đồ mô tả tỷ lệ BHYT theo thôn",
      }),
    ).toBeInTheDocument();

    for (const graphic of screen.getAllByRole("img")) {
      expect(graphic.querySelector("ol, ul, table")).toBeNull();
    }

    const paretoGraphic = screen.getByRole("img", {
      name: "Biểu đồ Pareto hộ nghèo và cận nghèo theo thôn",
    });
    const paretoData = screen.getByRole("list", {
      name: "Số hộ cần quan tâm theo từng thôn",
    });
    expect(paretoGraphic.contains(paretoData)).toBe(false);
    expect(
      screen.getByRole("list", {
        name: "Dữ liệu tỷ lệ BHYT theo từng thôn",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", {
        name: "Dữ liệu hướng dẫn dịch vụ công theo từng thôn",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", {
        name: "Dữ liệu trẻ em hoàn cảnh đặc biệt theo từng thôn",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Chưa đủ dữ liệu về trẻ em có hoàn cảnh đặc biệt",
      }),
    ).toBeInTheDocument();
  });

  it("associates trend table headers and exposes a keyboard-scrollable region", async () => {
    const periods: ReportPeriod[] = [
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
    ];
    const june = report({
      id: "report-june",
      period_id: "period-june",
      report_period: "Tháng 6/2026",
      updated_at: "2026-06-20T00:00:00Z",
    });
    const july = report({
      id: "report-july",
      period_id: "period-july",
      report_period: "Tháng 7/2026",
      updated_at: "2026-07-20T00:00:00Z",
    });

    const { container } = render(
      <DashboardInsightCharts
        reports={[july]}
        historicalReports={[june, july]}
        reportPeriods={periods}
        villageName={() => "Thôn Mức thấp"}
        singleVillage
      />,
    );

    const trendTable = screen.getByRole("table", {
      name: "Xu hướng chỉ tiêu của Thôn Mức thấp",
    });
    expect(trendTable.querySelector("caption")).toHaveTextContent(
      "Xu hướng các chỉ tiêu của Thôn Mức thấp qua từng kỳ báo cáo",
    );
    expect(trendTable.querySelectorAll('thead th[scope="col"]')).toHaveLength(5);
    expect(trendTable.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
    expect(
      screen.getByRole("region", {
        name: "Bảng xu hướng theo kỳ; có thể cuộn ngang trên màn hình nhỏ",
      }),
    ).toHaveAttribute("tabindex", "0");

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
