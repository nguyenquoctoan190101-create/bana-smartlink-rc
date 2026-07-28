import type {
  ReportData,
  SyncAcceptedItem,
  SyncRejectedItem,
  SyncReportsResponse,
} from "../types";
import { apiJson } from "./apiClient";
import {
  deleteReport,
  getSyncQueue,
  removeFromSyncQueue,
  saveReport,
} from "./db";

const WORKFLOW_STATUSES = new Set([
  "draft",
  "submitted",
  "needs_revision",
  "approved",
  "locked",
]);
const TIMELINESS_STATUSES = new Set(["not_submitted", "on_time", "late"]);
const PUBLICATION_STATUSES = new Set(["private", "published"]);

export interface ReportSyncResult {
  queuedCount: number;
  accepted: SyncAcceptedItem[];
  rejected: SyncRejectedItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSyncAcceptedItem(value: unknown): value is SyncAcceptedItem {
  if (!isRecord(value)) return false;
  const receivedAt =
    typeof value.server_received_at === "string"
      ? Date.parse(value.server_received_at)
      : Number.NaN;
  return (
    typeof value.client_id === "string" &&
    typeof value.report_id === "string" &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 1 &&
    typeof value.workflow_status === "string" &&
    WORKFLOW_STATUSES.has(value.workflow_status) &&
    typeof value.timeliness_status === "string" &&
    TIMELINESS_STATUSES.has(value.timeliness_status) &&
    typeof value.publication_status === "string" &&
    PUBLICATION_STATUSES.has(value.publication_status) &&
    Number.isFinite(receivedAt) &&
    value.next_step === "await_commune_review" &&
    typeof value.replayed === "boolean"
  );
}

function isSyncRejectedItem(value: unknown): value is SyncRejectedItem {
  return (
    isRecord(value) &&
    typeof value.client_id === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function parseSyncReportsResponse(value: unknown): SyncReportsResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.accepted) ||
    !Array.isArray(value.rejected) ||
    !value.accepted.every(isSyncAcceptedItem) ||
    !value.rejected.every(isSyncRejectedItem)
  ) {
    throw new Error("Máy chủ trả về biên nhận đồng bộ không hợp lệ.");
  }
  return value as unknown as SyncReportsResponse;
}

function authoritativeReport(
  queued: ReportData,
  accepted: SyncAcceptedItem,
): ReportData {
  return {
    ...queued,
    id: accepted.report_id,
    version: accepted.version,
    workflow_status: accepted.workflow_status,
    timeliness_status: accepted.timeliness_status,
    publication_status: accepted.publication_status,
    submitted_at: accepted.server_received_at,
    submission_next_step: accepted.next_step,
    submission_replayed: accepted.replayed,
    status:
      accepted.workflow_status === "submitted"
        ? "Submitted"
        : accepted.workflow_status === "approved"
          ? "Approved"
          : accepted.workflow_status === "locked"
            ? "Locked"
            : "Draft",
    pending_sync: false,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Send every locally queued report and apply only per-item server ACKs.
 *
 * Rejected or unacknowledged items deliberately stay in the queue. An accepted
 * item is first persisted under its authoritative server id, then removed from
 * the queue, so a browser storage failure cannot silently lose the submission.
 */
export async function syncQueuedReports(): Promise<ReportSyncResult> {
  const queue = await getSyncQueue();
  if (queue.length === 0) {
    return { queuedCount: 0, accepted: [], rejected: [] };
  }

  const rawResponse = await apiJson<unknown>("/reports/sync", {
    method: "POST",
    body: JSON.stringify({ reports: queue }),
  });
  const response = parseSyncReportsResponse(rawResponse);
  const accepted = response.accepted;
  const rejected = response.rejected;
  const byClientId = new Map(queue.map((report) => [report.id, report]));

  for (const ack of accepted) {
    const queued = byClientId.get(ack.client_id);
    if (!queued) continue;
    await saveReport(authoritativeReport(queued, ack));
    await removeFromSyncQueue(ack.client_id);
    if (ack.report_id !== ack.client_id) {
      await deleteReport(ack.client_id);
    }
  }

  return { queuedCount: queue.length, accepted, rejected };
}
