"""Atomic, validated approval actions for citizen proposals."""

from __future__ import annotations

import json
from typing import Literal
from uuid import UUID

import asyncpg

from services.settings import load_settings
from services.validator import BLOCKING_ERROR_TYPES, ValidationError, validate_report


class ProposalValidationError(ValueError):
    """The proposed value would leave the report invalid."""

    def __init__(self, errors: list[ValidationError]) -> None:
        super().__init__("Proposed value violates deterministic report rules")
        self.errors = errors


async def execute_proposal_action(
    proposal_id: UUID,
    action: Literal["approve", "reject"],
    user_id: UUID,
    action_notes: str | None = None,
) -> dict[str, object]:
    """Review a proposal without bypassing the report validation lifecycle.

    Approval applies the candidate value only after deterministic validation.
    The formerly approved/public report becomes private and needs revision, so
    it must be approved and published again deliberately.
    """
    settings = load_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    conn = await asyncpg.connect(dsn=settings.database_url, statement_cache_size=0)
    try:
        async with conn.transaction():
            proposal = await conn.fetchrow(
                """
                select proposal.id, proposal.report_id, proposal.ct_code,
                       proposal.proposed_value, proposal.status,
                       report.workflow_status::text as workflow_status,
                       report.publication_status::text as publication_status,
                       report.version
                from pending_updates as proposal
                join reports as report on report.id = proposal.report_id
                where proposal.id = $1
                for update of proposal, report
                """,
                proposal_id,
            )
            if not proposal:
                raise ValueError("Proposal not found")
            if proposal["status"] != "pending":
                raise ValueError("Proposal is not pending")

            validation_errors: list[ValidationError] = []
            new_version = int(proposal["version"])
            if action == "approve":
                if (
                    proposal["workflow_status"] not in {"approved", "locked"}
                    or proposal["publication_status"] != "published"
                ):
                    raise ValueError("Report is not eligible for a public proposal update")

                existing_values = await conn.fetch(
                    "select ct_code, value from report_values where report_id = $1",
                    proposal["report_id"],
                )
                candidate_values = {
                    str(row["ct_code"]): row["value"] for row in existing_values
                }
                candidate_values[str(proposal["ct_code"])] = proposal["proposed_value"]
                validation_errors = validate_report(candidate_values)
                blocking_errors = [
                    error
                    for error in validation_errors
                    if error["error_type"] in BLOCKING_ERROR_TYPES
                ]
                if blocking_errors:
                    raise ProposalValidationError(blocking_errors)

                await conn.execute(
                    """
                    insert into report_values (report_id, ct_code, value)
                    values ($1, $2, $3)
                    on conflict (report_id, ct_code) do update
                      set value = excluded.value, updated_at = now()
                    """,
                    proposal["report_id"],
                    proposal["ct_code"],
                    proposal["proposed_value"],
                )
                await conn.execute(
                    "delete from report_validation_flags where report_id = $1 and not resolved",
                    proposal["report_id"],
                )
                for error in validation_errors:
                    await conn.execute(
                        """
                        insert into report_validation_flags (report_id, ct_code, error_type, message)
                        values ($1, $2, $3::validation_error_type, $4)
                        """,
                        proposal["report_id"],
                        error["ct_code"],
                        error["error_type"],
                        error["message"],
                    )
                new_version = await conn.fetchval(
                    """
                    update reports
                    set workflow_status = 'needs_revision',
                        publication_status = 'private',
                        version = version + 1,
                        approved_by = null, approved_at = null,
                        locked_by = null, locked_at = null,
                        published_by = null, published_at = null,
                        updated_at = now()
                    where id = $1
                    returning version
                    """,
                    proposal["report_id"],
                )

            new_status = "approved" if action == "approve" else "rejected"
            await conn.execute(
                """
                update pending_updates
                set status = $1::pending_update_status, reviewed_by = $2,
                    reviewed_at = now(), review_notes = $3, updated_at = now()
                where id = $4
                """,
                new_status,
                user_id,
                action_notes,
                proposal_id,
            )
            await conn.execute(
                """
                insert into audit_log (action, table_name, record_id, user_id, details)
                values ($1, 'pending_updates', $2, $3, $4::jsonb)
                """,
                f"PROPOSAL_{action.upper()}",
                proposal_id,
                user_id,
                json.dumps(
                    {
                        "ct_code": str(proposal["ct_code"]),
                        "proposed_value": int(proposal["proposed_value"]),
                        "report_id": str(proposal["report_id"]),
                        "report_version": int(new_version),
                        "validation_warning_codes": [
                            error["ct_code"]
                            for error in validation_errors
                            if error["error_type"] not in BLOCKING_ERROR_TYPES
                        ],
                    }
                ),
            )
            return {
                "id": proposal["id"],
                "status": new_status,
                "report_id": proposal["report_id"],
                "ct_code": proposal["ct_code"],
                "report_version": int(new_version),
            }
    finally:
        await conn.close()
