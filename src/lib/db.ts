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

function optionalTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Map one API row without conflating submission, approval and update times. */
export function reportDataFromApiRow(
  raw: unknown,
  periodNames: ReadonlyMap<string, string> = new Map(),
  publicOnly = false,
): ReportData {
  const row = (raw || {}) as Record<string, any>;
  const values = (row.values || {}) as Record<string, unknown>;
  const indicators = Object.fromEntries(INDICATOR_CODES.map((code) => [
    code,
    typeof values[code] === "number" && Number.isFinite(values[code]) ? values[code] : null,
  ])) as Pick<ReportData, (typeof INDICATOR_CODES)[number]>;
  const submittedAt = optionalTimestamp(row.submitted_at);
  const approvedAt = optionalTimestamp(row.approved_at);
  const publishedAt = optionalTimestamp(row.published_at);
  const serverUpdatedAt = optionalTimestamp(row.updated_at);

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
    // Internal responses carry the authoritative reports.updated_at value. The
    // fallbacks keep older/public response shapes readable without relabelling
    // submitted_at as updated_at whenever the true field is present.
    updated_at: serverUpdatedAt || publishedAt || submittedAt || "",
    submitted_at: submittedAt,
    approved_at: approvedAt,
    published_at: publishedAt,
    raw_source: (row.report_source || "manual") as ReportSource,
  };
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

  return rows.map((raw) => reportDataFromApiRow(raw, periodNames, publicOnly));
}

export async function saveReport(report: ReportData): Promise<void> {
  const db = await initDB();
  await db.put(REPORTS_STORE, stored(report));
}

/**
 * Pick the newest editable device draft for a village/period pair. Queued
 * submissions are deliberately excluded: once the user has submitted a
 * report, it must stay immutable until the server ACKs or rejects that item.
 */
export function selectLatestDraftForScope(
  reports: ReportData[],
  villageId: string,
  periodId: string,
): ReportData | null {
  return reports
    .filter((report) => (
      report.village_id === villageId
      && report.period_id === periodId
      && !report.pending_sync
    ))
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0] || null;
}

export async function getLocalDraftForScope(
  villageId: string,
  periodId: string,
): Promise<ReportData | null> {
  const db = await initDB();
  const values = await db.getAllFromIndex(REPORTS_STORE, "by-owner", activeOwnerKey) as StoredReport[];
  return selectLatestDraftForScope(values.map(stripStorageFields), villageId, periodId);
}

/**
 * Upsert one editable draft per authenticated owner, village and period.
 * Older duplicate drafts from previous releases are removed in the same
 * transaction so the dashboard always offers one unambiguous continuation.
 */
export async function saveDraftForScope(report: ReportData): Promise<ReportData> {
  const db = await initDB();
  const existingValues = await db.getAllFromIndex(REPORTS_STORE, "by-owner", activeOwnerKey) as StoredReport[];
  const existing = selectLatestDraftForScope(existingValues.map(stripStorageFields), report.village_id, report.period_id || "");
  const draft = existing ? { ...report, id: existing.id } : report;
  const tx = db.transaction(REPORTS_STORE, "readwrite");
  const store = tx.objectStore(REPORTS_STORE);

  for (const value of existingValues) {
    if (
      value.village_id === report.village_id
      && value.period_id === report.period_id
      && !value.pending_sync
      && value.id !== draft.id
    ) {
      await store.delete(value.storage_key);
    }
  }
  await store.put(stored(draft));
  await tx.done;
  return draft;
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
