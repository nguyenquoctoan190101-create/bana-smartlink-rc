import { openDB } from "idb";
import { INDICATOR_CODES, type ReportData, type ReportPeriod, type ReportSource, type WorkflowStatus, type TimelinessStatus, type PublicationStatus } from "../types";
import { apiJson } from "./apiClient";

const DB_NAME = "BaNaSmartLinkOffline";
const DB_VERSION = 3;
const REPORTS_STORE = "reports";
const QUEUE_STORE = "sync_queue";

interface StoredReport extends ReportData {
  owner_key: string;
  storage_key: string;
}

let activeOwnerKey = "anonymous";

export function setOfflineOwner(userId: string | null, villageId: string | null): void {
  activeOwnerKey = userId ? `${userId}:${villageId || "commune"}` : "anonymous";
}

function stored(report: ReportData): StoredReport {
  const privacySafeReport = sanitizeReportForOffline(report);
  return {
    ...privacySafeReport,
    owner_key: activeOwnerKey,
    storage_key: `${activeOwnerKey}:${report.id}`,
  };
}

/**
 * Offline stores contain aggregate indicators only. The authenticated user's
 * identity remains in the server profile and is recovered from the JWT;
 * duplicating names or phone numbers in IndexedDB is unnecessary PII storage.
 */
export function sanitizeReportForOffline(report: ReportData): ReportData {
  return { ...report, reporter_name: "", reporter_phone: "" };
}

async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains(REPORTS_STORE)) db.deleteObjectStore(REPORTS_STORE);
      if (db.objectStoreNames.contains(QUEUE_STORE)) db.deleteObjectStore(QUEUE_STORE);
      const reports = db.createObjectStore(REPORTS_STORE, { keyPath: "storage_key" });
      reports.createIndex("by-owner", "owner_key");
      const queue = db.createObjectStore(QUEUE_STORE, { keyPath: "storage_key" });
      queue.createIndex("by-owner", "owner_key");
    },
  });
}

function stripStorageFields(value: StoredReport): ReportData {
  const { owner_key: _owner, storage_key: _key, ...report } = value;
  return report;
}

export async function getAllReports(publicOnly = false): Promise<ReportData[]> {
  const path = publicOnly ? "/reports/public" : "/reports";
  const [payload, periods] = await Promise.all([
    apiJson<unknown[] | { items: unknown[] }>(path),
    publicOnly ? Promise.resolve<ReportPeriod[]>([]) : apiJson<ReportPeriod[]>("/report-periods"),
  ]);
  const rows = Array.isArray(payload) ? payload : (payload.items || []);
  const periodNames = new Map(periods.map((period) => [period.id, period.name]));

  return rows.map((raw) => {
    const row = (raw || {}) as Record<string, any>;
    const values = (row.values || {}) as Record<string, unknown>;
    const indicators = Object.fromEntries(INDICATOR_CODES.map((code) => [
      code,
      typeof values[code] === "number" && Number.isFinite(values[code]) ? values[code] : null,
    ])) as Pick<ReportData, (typeof INDICATOR_CODES)[number]>;
    return {
      ...indicators,
      id: String(row.id),
      village_id: String(row.village_id),
      period_id: row.period_id ? String(row.period_id) : undefined,
      report_period: String(row.report_period || periodNames.get(String(row.period_id)) || "Chưa xác định"),
      reporter_name: "",
      reporter_phone: "",
      workflow_status: (row.workflow_status || (publicOnly ? "approved" : "draft")) as WorkflowStatus,
      timeliness_status: (row.timeliness_status || "not_submitted") as TimelinessStatus,
      publication_status: (row.publication_status || (publicOnly ? "published" : "private")) as PublicationStatus,
      version: typeof row.version === "number" ? row.version : undefined,
      updated_at: String(row.submitted_at || row.published_at || ""),
      raw_source: (row.report_source || "manual") as ReportSource,
    };
  });
}

export async function saveReport(report: ReportData): Promise<void> {
  const db = await initDB();
  await db.put(REPORTS_STORE, stored(report));
}

/**
 * A submission is not authoritative until the server acknowledges it. Keep the
 * device copy as a draft while making its queued state explicit so the UI does
 * not claim that the report has already been submitted.
 */
export function prepareReportForSync(report: ReportData): ReportData {
  return {
    ...report,
    workflow_status: "draft",
    timeliness_status: "not_submitted",
    publication_status: "private",
    status: "Draft",
    pending_sync: true,
  };
}

/** Persist the device copy and its sync item atomically. */
export async function queueReportForSync(report: ReportData): Promise<void> {
  const db = await initDB();
  const queued = stored(prepareReportForSync(report));
  const tx = db.transaction([REPORTS_STORE, QUEUE_STORE], "readwrite");
  await Promise.all([
    tx.objectStore(REPORTS_STORE).put(queued),
    tx.objectStore(QUEUE_STORE).put(queued),
  ]);
  await tx.done;
}

/** Delete only a device-local draft. Server reports require an authenticated API delete. */
export async function deleteReport(id: string): Promise<void> {
  const db = await initDB();
  await db.delete(REPORTS_STORE, `${activeOwnerKey}:${id}`);
}

export async function getLocalDrafts(): Promise<ReportData[]> {
  const db = await initDB();
  const values = await db.getAllFromIndex(REPORTS_STORE, "by-owner", activeOwnerKey) as StoredReport[];
  return values.map((value) => ({ ...stripStorageFields(value), local_only: true }));
}

export async function getSyncQueue(): Promise<ReportData[]> {
  const db = await initDB();
  const values = await db.getAllFromIndex(QUEUE_STORE, "by-owner", activeOwnerKey) as StoredReport[];
  return values.map(stripStorageFields);
}

export async function addToSyncQueue(report: ReportData): Promise<void> {
  const db = await initDB();
  await db.put(QUEUE_STORE, stored(prepareReportForSync(report)));
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  const db = await initDB();
  await db.delete(QUEUE_STORE, `${activeOwnerKey}:${id}`);
}

export async function clearOfflineData(): Promise<void> {
  const db = await initDB();
  const tx = db.transaction([REPORTS_STORE, QUEUE_STORE], "readwrite");
  const reportKeys = await tx.objectStore(REPORTS_STORE).index("by-owner").getAllKeys(activeOwnerKey);
  const queueKeys = await tx.objectStore(QUEUE_STORE).index("by-owner").getAllKeys(activeOwnerKey);
  await Promise.all([
    ...reportKeys.map((key) => tx.objectStore(REPORTS_STORE).delete(key)),
    ...queueKeys.map((key) => tx.objectStore(QUEUE_STORE).delete(key)),
  ]);
  await tx.done;
}
