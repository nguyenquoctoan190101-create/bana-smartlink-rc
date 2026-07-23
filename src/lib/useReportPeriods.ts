import { useEffect, useState } from "react";
import { apiJson } from "./apiClient";
import type { ReportPeriod } from "../types";
import { decorateReportPeriod } from "./reportPeriods";

let cachedPeriods: ReportPeriod[] | null = null;
let inFlight: Promise<ReportPeriod[]> | null = null;
let cacheGeneration = 0;
const invalidationListeners = new Set<() => void>();

export async function loadReportPeriods(force = false): Promise<ReportPeriod[]> {
  if (force) {
    cachedPeriods = null;
    cacheGeneration += 1;
    inFlight = null;
  }
  if (cachedPeriods) return cachedPeriods;
  if (!inFlight) {
    const requestGeneration = cacheGeneration;
    const request = apiJson<ReportPeriod[]>("/report-periods")
      .then((rows) => {
        const normalized = Array.isArray(rows) ? rows.map(decorateReportPeriod) : [];
        if (requestGeneration === cacheGeneration) cachedPeriods = normalized;
        return normalized;
      })
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
  }
  return inFlight;
}

/**
 * Clear the shared period cache and notify every mounted consumer. A period is
 * created independently from reports, so report creation/deletion must never
 * be the mechanism that refreshes this list.
 */
export function invalidateReportPeriods() {
  cachedPeriods = null;
  cacheGeneration += 1;
  inFlight = null;
  invalidationListeners.forEach((listener) => listener());
}

export function useReportPeriods() {
  const [periods, setPeriods] = useState<ReportPeriod[]>(cachedPeriods || []);
  const [isLoading, setIsLoading] = useState(cachedPeriods === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = (force = false) => {
      setIsLoading(true);
      setError(null);
      void loadReportPeriods(force)
        .then((rows) => { if (active) setPeriods(rows); })
        .catch(() => { if (active) setError("Không tải được danh sách kỳ báo cáo."); })
        .finally(() => { if (active) setIsLoading(false); });
    };
    const handleInvalidation = () => refresh(false);
    invalidationListeners.add(handleInvalidation);
    refresh(false);
    return () => {
      active = false;
      invalidationListeners.delete(handleInvalidation);
    };
  }, []);

  return { periods, isLoading, error };
}
