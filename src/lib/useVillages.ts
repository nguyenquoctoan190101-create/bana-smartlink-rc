import { useEffect, useState } from "react";
import { apiJson } from "./apiClient";
import type { Village } from "../types";

let cachedVillages: Village[] | null = null;
let inFlight: Promise<Village[]> | null = null;

export async function loadVillages(): Promise<Village[]> {
  if (cachedVillages) return cachedVillages;
  if (!inFlight) {
    inFlight = apiJson<Village[]>("/reports/villages", { auth: "none" })
      .then((rows) => {
        cachedVillages = Array.isArray(rows)
          ? rows.filter((row) => row && typeof row.id === "string" && typeof row.name === "string")
          : [];
        return cachedVillages;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useVillages() {
  const [villages, setVillages] = useState<Village[]>(cachedVillages || []);
  const [isLoading, setIsLoading] = useState(cachedVillages === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadVillages()
      .then((rows) => { if (active) setVillages(rows); })
      .catch(() => { if (active) setError("Không tải được danh mục thôn từ máy chủ."); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  return { villages, isLoading, error };
}
