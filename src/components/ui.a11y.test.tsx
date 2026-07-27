import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { DataScope, EmptyState, MetricCard, PageHeader, StatusBadge, Wordmark, WorkSection } from "./ui";

describe("civic design system accessibility", () => {
  it("renders core components without serious or critical axe violations", async () => {
    const { container } = render(<main>
      <Wordmark />
      <PageHeader eyebrow="Điều hành" title="Việc của tôi" description="Theo dõi việc cần xử lý." />
      <DataScope period="Tháng 7/2026" scope="Thôn mẫu" quality="Đạt" />
      <MetricCard label="Báo cáo cần xem" value="—" context="Chưa có dữ liệu" />
      <WorkSection index="01" title="Ưu tiên điều hành" description="Tách riêng các điểm cần chú ý." tone="focus">
        <p>Nội dung nhóm công việc</p>
      </WorkSection>
      <StatusBadge status="needs_revision" />
      <StatusBadge status="accepted" />
      <StatusBadge status="ready" />
      <StatusBadge status="received" />
      <StatusBadge status="verifying" />
      <StatusBadge status="assigned" />
      <StatusBadge status="in_progress" />
      <StatusBadge status="completed" />
      <StatusBadge status="rejected" />
      <EmptyState title="Chưa có việc" description="Việc mới sẽ xuất hiện tại đây." />
    </main>);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
    expect(screen.getByText("Đã chấp nhận")).toBeInTheDocument();
    expect(screen.getAllByText("Đạt")).toHaveLength(2);
    expect(screen.getByText("Đã tiếp nhận").closest("span")).toHaveAttribute("data-tone", "info");
    expect(screen.getByText("Đang xác minh").closest("span")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("Đã phân công").closest("span")).toHaveAttribute("data-tone", "assigned");
    expect(screen.getByText("Đang xử lý").closest("span")).toHaveAttribute("data-tone", "progress");
    expect(screen.getByText("Hoàn tất").closest("span")).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Đã từ chối").closest("span")).toHaveAttribute("data-tone", "danger");
  });
});
