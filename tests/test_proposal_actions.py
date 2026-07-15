from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from services.proposal_actions import ProposalValidationError, execute_proposal_action


class _Transaction(AbstractAsyncContextManager[None]):
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        return False


class _Connection:
    def __init__(self, proposal: dict[str, object]) -> None:
        self.proposal = proposal
        self.executed: list[tuple[str, tuple[object, ...]]] = []
        self.fetch = AsyncMock(return_value=[])
        self.fetchval = AsyncMock(return_value=8)
        self.close = AsyncMock()

    def transaction(self) -> _Transaction:
        return _Transaction()

    async def fetchrow(self, *_args: object) -> dict[str, object]:
        return self.proposal

    async def execute(self, query: str, *args: object) -> None:
        self.executed.append((query, args))


def _proposal() -> dict[str, object]:
    return {
        "id": uuid4(),
        "report_id": uuid4(),
        "ct_code": "CT03",
        "proposed_value": 4,
        "status": "pending",
        "workflow_status": "approved",
        "publication_status": "published",
        "version": 7,
    }


@pytest.mark.asyncio
async def test_approved_proposal_is_reopened_and_audited_atomically() -> None:
    proposal = _proposal()
    connection = _Connection(proposal)
    connection.fetch.return_value = [{"ct_code": "CT03", "value": 3}]
    with (
        patch("services.proposal_actions.load_settings", return_value=SimpleNamespace(database_url="postgresql://test")),
        patch("services.proposal_actions.asyncpg.connect", new=AsyncMock(return_value=connection)),
        patch("services.proposal_actions.validate_report", return_value=[]),
    ):
        result = await execute_proposal_action(
            proposal["id"], "approve", uuid4(), "verified by admin"
        )

    executed_sql = "\n".join(query for query, _ in connection.executed)
    report_update_sql = connection.fetchval.await_args.args[0]
    assert "insert into report_values" in executed_sql
    assert "workflow_status = 'needs_revision'" in report_update_sql
    assert "publication_status = 'private'" in report_update_sql
    assert "insert into audit_log" in executed_sql
    audit_call = next(
        args for query, args in connection.executed if "insert into audit_log" in query
    )
    assert '"previous_value": 3' in audit_call[3]
    assert result["status"] == "approved"
    assert result["report_version"] == 8
    connection.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_invalid_proposal_does_not_write_anything() -> None:
    proposal = _proposal()
    connection = _Connection(proposal)
    blocking = [{"ct_code": "CT03", "error_type": "LOGIC", "message": "invalid"}]
    with (
        patch("services.proposal_actions.load_settings", return_value=SimpleNamespace(database_url="postgresql://test")),
        patch("services.proposal_actions.asyncpg.connect", new=AsyncMock(return_value=connection)),
        patch("services.proposal_actions.validate_report", return_value=blocking),
    ):
        with pytest.raises(ProposalValidationError) as raised:
            await execute_proposal_action(proposal["id"], "approve", uuid4())

    assert raised.value.errors == blocking
    assert connection.executed == []
    connection.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_rejected_proposal_never_changes_report_values() -> None:
    proposal = _proposal()
    connection = _Connection(proposal)
    with (
        patch("services.proposal_actions.load_settings", return_value=SimpleNamespace(database_url="postgresql://test")),
        patch("services.proposal_actions.asyncpg.connect", new=AsyncMock(return_value=connection)),
    ):
        result = await execute_proposal_action(proposal["id"], "reject", uuid4())

    executed_sql = "\n".join(query for query, _ in connection.executed)
    assert "insert into report_values" not in executed_sql
    assert "workflow_status = 'needs_revision'" not in executed_sql
    assert "update pending_updates" in executed_sql
    assert result["status"] == "rejected"
