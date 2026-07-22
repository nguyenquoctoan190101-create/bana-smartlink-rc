import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportPeriod } from "../types";
import { apiJson } from "./apiClient";
import { invalidateReportPeriods, loadReportPeriods } from "./useReportPeriods";

vi.mock("./apiClient", () => ({ apiJson: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

describe("report period cache", () => {
  beforeEach(() => {
    vi.mocked(apiJson).mockReset();
    invalidateReportPeriods();
  });

  it("does not let an obsolete request overwrite data loaded after invalidation", async () => {
    const obsolete = deferred<ReportPeriod[]>();
    const current = deferred<ReportPeriod[]>();
    const oldRows: ReportPeriod[] = [
      { id: "period-old", name: "Tháng 7/2026", due_date: "2026-07-25T17:00:00+07:00" },
    ];
    const newRows: ReportPeriod[] = [
      { id: "period-new", name: "Tháng 8/2026", due_date: "2026-08-25T17:00:00+07:00" },
    ];

    vi.mocked(apiJson)
      .mockImplementationOnce(() => obsolete.promise)
      .mockImplementationOnce(() => current.promise);

    const obsoleteLoad = loadReportPeriods();
    invalidateReportPeriods();
    const currentLoad = loadReportPeriods();
    current.resolve(newRows);
    await expect(currentLoad).resolves.toEqual(newRows);
    obsolete.resolve(oldRows);
    await expect(obsoleteLoad).resolves.toEqual(oldRows);

    await expect(loadReportPeriods()).resolves.toEqual(newRows);
    expect(apiJson).toHaveBeenCalledTimes(2);
  });
});
