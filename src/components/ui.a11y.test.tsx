import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { DataScope, EmptyState, MetricCard, PageHeader, StatusBadge, Wordmark } from "./ui";

describe("civic design system accessibility", () => {
  it("renders core components without serious or critical axe violations", async () => {
    const { container } = render(<main>
      <Wordmark />
      <PageHeader eyebrow="Điều hành" title="Việc của tôi" description="Theo dõi việc cần xử lý." />
      <DataScope period="Tháng 7/2026" scope="Thôn mẫu" quality="Đạt" />
      <MetricCard label="Báo cáo cần xem" value="—" context="Chưa có dữ liệu" />
      <StatusBadge status="needs_revision" />
      <StatusBadge status="accepted" />
      <StatusBadge status="ready" />
      <EmptyState title="Chưa có việc" description="Việc mới sẽ xuất hiện tại đây." />
    </main>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expect(screen.getByText("Đã chấp nhận")).toBeInTheDocument();
    expect(screen.getAllByText("Đạt")).toHaveLength(2);
  });
});
