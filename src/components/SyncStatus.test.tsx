import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SyncStatus from "./SyncStatus";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSyncQueue: vi.fn(),
  syncQueuedReports: vi.fn(),
}));

vi.mock("../lib/apiClient", () => ({
  apiFetch: mocks.apiFetch,
  toUserFacingError: (_error: unknown, fallback: string) => fallback,
}));

vi.mock("../lib/db", () => ({
  getSyncQueue: mocks.getSyncQueue,
}));

vi.mock("../lib/reportSync", () => ({
  syncQueuedReports: mocks.syncQueuedReports,
}));

describe("SyncStatus", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue(new Response(null, { status: 200 }));
    mocks.getSyncQueue.mockReset();
    mocks.syncQueuedReports.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("stays compact when the connection is healthy and the queue is empty", async () => {
    mocks.getSyncQueue.mockResolvedValue([]);
    render(<SyncStatus onSyncCompleted={vi.fn()} />);

    expect(
      await screen.findByText(/0 báo cáo chờ gửi/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Chỉ xóa khỏi hàng đợi/),
    ).not.toBeInTheDocument();

    const details = screen.getByRole("button", { name: /Chi tiết/ });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);

    expect(screen.getByText(/Chỉ xóa khỏi hàng đợi/)).toBeInTheDocument();
    expect(details).toHaveAttribute("aria-expanded", "true");
  });

  it("expands automatically when reports are waiting to be synchronized", async () => {
    mocks.getSyncQueue.mockResolvedValue([{ client_id: "queued-report" }]);
    render(<SyncStatus onSyncCompleted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/1 báo cáo chờ gửi/)).toBeInTheDocument();
      expect(screen.getByText(/Chỉ xóa khỏi hàng đợi/)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Đồng bộ ngay" }),
    ).toBeEnabled();
  });
});
