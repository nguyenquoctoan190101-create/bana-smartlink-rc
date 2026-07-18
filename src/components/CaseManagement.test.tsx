import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CaseManagement from "./CaseManagement";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
}));

describe("CaseManagement", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === "/api/cases") {
        return Promise.resolve([
          {
            id: "11111111-1111-4111-8111-111111111111",
            village_id: "village-1",
            category: "waste",
            description: "Rác thải tồn đọng cạnh nhà văn hóa.",
            priority: "normal",
            status: "received",
            assigned_department: "Bộ phận Địa chính - Xây dựng - Môi trường",
            sla_due_at: "2099-07-20T00:00:00Z",
            created_at: "2026-07-18T00:00:00Z",
            updated_at: "2026-07-18T00:00:00Z",
          },
        ]);
      }
      if (path === "/api/cases/routing-rules") {
        return Promise.resolve([
          {
            id: "rule-1",
            category: "waste",
            department: "Bộ phận Địa chính - Xây dựng - Môi trường",
            priority: "normal",
            verification_minutes: 240,
            resolution_minutes: 2880,
            escalation_department: "Lãnh đạo UBND xã Bà Nà",
            is_active: true,
            is_demo: true,
            sla_version: "demo-2026-07-18",
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected path ${path}`));
    });
  });

  it("shows demo SLA disclosure, queue data and routing catalogue", async () => {
    render(
      <CaseManagement
        role="admin_xa"
        villages={[{ id: "village-1", name: "Thôn An Sơn" }]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("SLA minh họa cho cuộc thi.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Thôn An Sơn")).toBeInTheDocument();
    expect(
      screen.getByText("Rác thải tồn đọng cạnh nhà văn hóa."),
    ).toBeInTheDocument();
    expect(screen.getByText("4 giờ")).toBeInTheDocument();
    expect(screen.getByText("2 ngày")).toBeInTheDocument();
    expect(
      screen.getAllByText("Bộ phận Địa chính - Xây dựng - Môi trường").length,
    ).toBeGreaterThan(0);
    const caseCard = screen
      .getByText("Rác thải tồn đọng cạnh nhà văn hóa.")
      .closest("article");
    expect(caseCard).toHaveAttribute("data-status", "received");
  });

  it("keeps leader mode read-only", async () => {
    render(
      <CaseManagement
        role="lanh_dao"
        villages={[{ id: "village-1", name: "Thôn An Sơn" }]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Giám sát phản ánh hiện trường"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Xác nhận phân công/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cập nhật trạng thái/i }),
    ).not.toBeInTheDocument();
  });
});
