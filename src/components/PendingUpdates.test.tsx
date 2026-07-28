import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PendingUpdates from "./PendingUpdates";

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock("../lib/apiClient", () => ({
  apiJson: mocks.apiJson,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("../lib/useVillages", () => ({
  useVillages: () => ({ villages: [] }),
}));

const auditLogs = [
  {
    id: "oldest",
    table_name: "pending_updates",
    record_id: "record-oldest",
    action: "PROPOSAL_APPROVE",
    created_at: "2026-07-28T08:00:00+07:00",
  },
  {
    id: "second-oldest",
    table_name: "report_periods",
    record_id: "record-second-oldest",
    action: "CREATE_REPORT_PERIOD",
    created_at: "2026-07-28T09:00:00+07:00",
  },
  {
    id: "third-newest",
    table_name: "reports",
    record_id: "record-third-newest",
    action: "DELETE",
    created_at: "2026-07-28T10:00:00+07:00",
  },
  {
    id: "second-newest",
    table_name: "reports",
    record_id: "record-second-newest",
    action: "INSERT",
    created_at: "2026-07-28T11:00:00+07:00",
  },
  {
    id: "newest",
    table_name: "reports",
    record_id: "record-newest",
    action: "UPDATE",
    created_at: "2026-07-28T12:00:00+07:00",
  },
];

describe("PendingUpdates audit log disclosure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === "/auth/proposals") return Promise.resolve([]);
      if (path === "/auth/report-values") return Promise.resolve([]);
      if (path === "/auth/audit-logs") return Promise.resolve(auditLogs);
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  afterEach(() => cleanup());

  it("shows only the three newest records until the user expands the log", async () => {
    const user = userEvent.setup();
    render(
      <PendingUpdates
        userRole="admin_xa"
        userVillageId={null}
        userName="Quản trị xã"
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Cập nhật bản ghi")).toBeInTheDocument(),
    );
    expect(screen.getByText("Tạo bản ghi")).toBeInTheDocument();
    expect(screen.getByText("Xóa bản ghi")).toBeInTheDocument();
    expect(screen.queryByText("Tạo kỳ báo cáo")).not.toBeInTheDocument();
    expect(screen.queryByText("Phê duyệt kiến nghị")).not.toBeInTheDocument();
    expect(screen.getByText("Đang hiển thị 3/5 bản ghi mới nhất")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Xem tất cả 5 bản ghi" }),
    );

    expect(screen.getByText("Tạo kỳ báo cáo")).toBeInTheDocument();
    expect(screen.getByText("Phê duyệt kiến nghị")).toBeInTheDocument();
    expect(screen.getByText("Đang hiển thị 5/5 bản ghi")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Chỉ xem 3 bản ghi mới nhất" }),
    );
    expect(screen.queryByText("Tạo kỳ báo cáo")).not.toBeInTheDocument();
  });
});
