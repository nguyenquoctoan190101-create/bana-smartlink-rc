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

export interface ReportSyncResult {
  queuedCount: number;
  accepted: SyncAcceptedItem[];
  rejected: SyncRejectedItem[];
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

  const response = await apiJson<SyncReportsResponse>("/reports/sync", {
    method: "POST",
    body: JSON.stringify({ reports: queue }),
  });
  const accepted = response.accepted || [];
  const rejected = response.rejected || [];
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
