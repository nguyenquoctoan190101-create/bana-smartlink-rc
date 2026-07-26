import type { ReportData, WorkflowStatus } from "../types";
import { apiJson } from "./apiClient";

type ReportWorkflowAction = "approve" | "lock";

interface WorkflowTransitionResponse {
  report_id: string;
  workflow_status?: WorkflowStatus;
  publication_status?: "private" | "published";
  version: number;
}

function reportVersion(report: ReportData): number {
  if (!Number.isInteger(report.version) || Number(report.version) < 1) {
    throw new Error(
      "Báo cáo chưa có phiên bản máy chủ. Vui lòng tải lại danh sách trước khi thao tác.",
    );
  }
  return Number(report.version);
}

function reportPath(report: ReportData): string {
  return `/reports/${encodeURIComponent(report.id)}`;
}

/** Delete a server report with optimistic concurrency protection. */
export async function deleteServerReport(report: ReportData): Promise<void> {
  const expectedVersion = reportVersion(report);
  await apiJson<void>(
    `${reportPath(report)}?expected_version=${expectedVersion}`,
    { method: "DELETE" },
  );
}

/** Approve or lock the exact report version currently shown to the operator. */
export async function transitionServerReport(
  report: ReportData,
  action: ReportWorkflowAction,
): Promise<WorkflowTransitionResponse> {
  const expectedVersion = reportVersion(report);
  return apiJson<WorkflowTransitionResponse>(`${reportPath(report)}/approve`, {
    method: "PATCH",
    body: JSON.stringify({
      action,
      expected_version: expectedVersion,
    }),
  });
}

/** Publish the exact approved/locked report version currently on screen. */
export async function publishServerReport(
  report: ReportData,
): Promise<WorkflowTransitionResponse> {
  const expectedVersion = reportVersion(report);
  return apiJson<WorkflowTransitionResponse>(
    `${reportPath(report)}/publish?expected_version=${expectedVersion}`,
    { method: "PATCH" },
  );
}
