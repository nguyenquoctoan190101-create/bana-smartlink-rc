import { useEffect, useState } from "react";
import { apiJson } from "./apiClient";
import type { ReportPeriod } from "../types";

let cachedPeriods: ReportPeriod[] | null = null;
let inFlight: Promise<ReportPeriod[]> | null = null;

export async function loadReportPeriods(): Promise<ReportPeriod[]> {
  if (cachedPeriods) return cachedPeriods;
  if (!inFlight) {
    inFlight = apiJson<ReportPeriod[]>("/report-periods")
      .then((rows) => {
        cachedPeriods = Array.isArray(rows) ? rows : [];
        return cachedPeriods;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useReportPeriods() {
  const [periods, setPeriods] = useState<ReportPeriod[]>(cachedPeriods || []);
  const [isLoading, setIsLoading] = useState(cachedPeriods === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadReportPeriods()
      .then((rows) => { if (active) setPeriods(rows); })
      .catch(() => { if (active) setError("Không tải được danh sách kỳ báo cáo."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  return { periods, isLoading, error };
}
