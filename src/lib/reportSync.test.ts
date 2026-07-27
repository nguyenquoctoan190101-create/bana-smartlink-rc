import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportData, SyncReportsResponse } from "../types";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
  deleteReport: vi.fn(),
  getSyncQueue: vi.fn(),
  removeFromSyncQueue: vi.fn(),
  saveReport: vi.fn(),
}));

vi.mock("./apiClient", () => ({ apiJson: mocks.apiJson }));
vi.mock("./db", () => ({
  deleteReport: mocks.deleteReport,
  getSyncQueue: mocks.getSyncQueue,
  removeFromSyncQueue: mocks.removeFromSyncQueue,
  saveReport: mocks.saveReport,
}));

import { syncQueuedReports } from "./reportSync";

const queuedReport: ReportData = {
  id: "client-1",
  village_id: "village-1",
  period_id: "period-1",
  report_period: "Tháng 7/2026",
  reporter_name: "",
  reporter_phone: "",
  workflow_status: "draft",
  timeliness_status: "not_submitted",
  publication_status: "private",
  pending_sync: true,
  updated_at: "2026-07-27T00:00:00Z",
  CT01: 1,
  CT02: 1,
  CT03: 1,
  CT04: 1,
  CT05: 1,
  CT06: 1,
  CT07: 1,
  CT08: 1,
  CT09: 1,
  CT10: 1,
  CT11: 1,
  CT12: 1,
  CT13: 1,
  CT14: 1,
};

describe("syncQueuedReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSyncQueue.mockResolvedValue([queuedReport]);
  });

  it("persists the authoritative ACK before removing the queued item", async () => {
    const response: SyncReportsResponse = {
      accepted: [{
        client_id: "client-1",
        report_id: "server-1",
        version: 1,
        workflow_status: "submitted",
        timeliness_status: "on_time",
        publication_status: "private",
      }],
      rejected: [],
    };
    mocks.apiJson.mockResolvedValue(response);

    const result = await syncQueuedReports();

    expect(result.accepted).toHaveLength(1);
    expect(mocks.saveReport).toHaveBeenCalledWith(expect.objectContaining({
      id: "server-1",
      workflow_status: "submitted",
      pending_sync: false,
    }));
    expect(mocks.saveReport.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeFromSyncQueue.mock.invocationCallOrder[0],
    );
    expect(mocks.removeFromSyncQueue).toHaveBeenCalledWith("client-1");
    expect(mocks.deleteReport).toHaveBeenCalledWith("client-1");
  });

  it("keeps rejected reports in the queue", async () => {
    mocks.apiJson.mockResolvedValue({
      accepted: [],
      rejected: [{
        client_id: "client-1",
        code: "REPORT_CONFLICT",
        message: "Báo cáo đã thay đổi.",
        retryable: false,
      }],
    } satisfies SyncReportsResponse);

    const result = await syncQueuedReports();

    expect(result.rejected).toHaveLength(1);
    expect(mocks.saveReport).not.toHaveBeenCalled();
    expect(mocks.removeFromSyncQueue).not.toHaveBeenCalled();
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });

  it("does not touch local data when the request fails", async () => {
    mocks.apiJson.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(syncQueuedReports()).rejects.toThrow("Failed to fetch");
    expect(mocks.saveReport).not.toHaveBeenCalled();
    expect(mocks.removeFromSyncQueue).not.toHaveBeenCalled();
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });
});
