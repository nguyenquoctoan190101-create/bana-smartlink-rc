import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportData } from "../types";

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn(),
}));

vi.mock("./apiClient", () => ({
  apiJson: mocks.apiJson,
}));

import {
  deleteServerReport,
  publishServerReport,
  transitionServerReport,
} from "./reportWorkflow";

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    id: "report/with unsafe path",
    village_id: "village-1",
    period_id: "period-1",
    report_period: "Tháng 7/2026",
    reporter_name: "",
    reporter_phone: "",
    workflow_status: "submitted",
    timeliness_status: "on_time",
    publication_status: "private",
    version: 7,
    updated_at: "2026-07-26T00:00:00Z",
    CT01: 10,
    CT02: 40,
    CT03: 1,
    CT04: 1,
    CT05: 1,
    CT06: 1,
    CT07: 10,
    CT08: 1,
    CT09: 9,
    CT10: 20,
    CT11: 30,
    CT12: 6,
    CT13: 2,
    CT14: 1,
    ...overrides,
  };
}

describe("report workflow API", () => {
  beforeEach(() => {
    mocks.apiJson.mockReset();
    mocks.apiJson.mockResolvedValue({});
  });

  it("sends the displayed version when deleting a report", async () => {
    await deleteServerReport(report());

    expect(mocks.apiJson).toHaveBeenCalledWith(
      "/reports/report%2Fwith%20unsafe%20path?expected_version=7",
      { method: "DELETE" },
    );
  });

  it("sends the displayed version in approve and lock payloads", async () => {
    const current = report();

    await transitionServerReport(current, "approve");
    await transitionServerReport(current, "lock");

    expect(mocks.apiJson).toHaveBeenNthCalledWith(
      1,
      "/reports/report%2Fwith%20unsafe%20path/approve",
      {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", expected_version: 7 }),
      },
    );
    expect(mocks.apiJson).toHaveBeenNthCalledWith(
      2,
      "/reports/report%2Fwith%20unsafe%20path/approve",
      {
        method: "PATCH",
        body: JSON.stringify({ action: "lock", expected_version: 7 }),
      },
    );
  });

  it("sends the displayed version when publishing", async () => {
    await publishServerReport(report({ workflow_status: "approved" }));

    expect(mocks.apiJson).toHaveBeenCalledWith(
      "/reports/report%2Fwith%20unsafe%20path/publish?expected_version=7",
      { method: "PATCH" },
    );
  });

  it("fails locally instead of issuing an unversioned mutation", async () => {
    await expect(deleteServerReport(report({ version: undefined }))).rejects.toThrow(
      "chưa có phiên bản máy chủ",
    );
    expect(mocks.apiJson).not.toHaveBeenCalled();
  });
});
