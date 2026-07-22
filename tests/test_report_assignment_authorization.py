from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers.reports import _authorize_report_write, _authorize_village_read
from services.supabase_admin import SupabaseAdminError, UserProfile


def _repository_with_assignment_result(result):
    rest_request = AsyncMock(return_value=result)
    repository = SimpleNamespace(
        _supabase=SimpleNamespace(_rest_request=rest_request),
    )
    return repository, rest_request


def _profile(*, role: str, village_id: str | None = None) -> UserProfile:
    return UserProfile(
        id=str(uuid4()),
        role=role,
        village_id=village_id,
        force_password_reset=False,
        display_name="Người dùng kiểm thử",
    )


@pytest.mark.asyncio
async def test_cnscd_can_read_and_write_an_explicitly_assigned_village():
    assigned_village_id = uuid4()
    user = _profile(role="to_cnscd")
    repository, rest_request = _repository_with_assignment_result(
        [{"village_id": str(assigned_village_id)}]
    )

    await _authorize_village_read(repository, user, assigned_village_id)
    await _authorize_report_write(repository, user, assigned_village_id)

    assert rest_request.await_count == 2
    for call in rest_request.await_args_list:
        method, path = call.args
        assert method == "GET"
        assert "/rest/v1/user_village_assignments" in path
        assert f"user_id=eq.{user.id}" in path
        assert f"village_id=eq.{assigned_village_id}" in path


@pytest.mark.asyncio
async def test_cnscd_cannot_access_an_unassigned_village():
    user = _profile(role="to_cnscd")
    repository, _ = _repository_with_assignment_result([])

    with pytest.raises(HTTPException) as read_error:
        await _authorize_village_read(repository, user, uuid4())
    with pytest.raises(HTTPException) as write_error:
        await _authorize_report_write(repository, user, uuid4())

    assert read_error.value.status_code == 403
    assert write_error.value.status_code == 403


@pytest.mark.asyncio
async def test_assignment_lookup_failure_is_fail_closed():
    user = _profile(role="to_cnscd")
    rest_request = AsyncMock(
        side_effect=SupabaseAdminError("PostgREST unavailable", status_code=503)
    )
    repository = SimpleNamespace(
        _supabase=SimpleNamespace(_rest_request=rest_request),
    )

    with pytest.raises(HTTPException) as error:
        await _authorize_report_write(repository, user, uuid4())

    assert error.value.status_code == 503
    assert error.value.detail == "Unable to verify village assignment"


@pytest.mark.asyncio
async def test_village_officer_cannot_use_cnscd_assignment_scope():
    own_village_id = uuid4()
    user = _profile(role="can_bo_thon", village_id=str(own_village_id))
    repository, rest_request = _repository_with_assignment_result(
        [{"village_id": str(uuid4())}]
    )

    with pytest.raises(HTTPException) as error:
        await _authorize_report_write(repository, user, uuid4())

    assert error.value.status_code == 403
    rest_request.assert_not_awaited()
