from unittest.mock import AsyncMock, patch

import asyncpg
import pytest

from routers.auth import _connect_db


@pytest.mark.asyncio
async def test_database_connect_retries_once_after_admin_shutdown():
    connection = AsyncMock()
    connect = AsyncMock(
        side_effect=[
            asyncpg.AdminShutdownError(
                "terminating connection due to administrator command"
            ),
            connection,
        ]
    )

    with (
        patch("routers.auth.asyncpg.connect", new=connect),
        patch("routers.auth.asyncio.sleep", new_callable=AsyncMock) as sleep,
    ):
        result = await _connect_db("postgresql://test")

    assert result is connection
    assert connect.await_count == 2
    assert connect.await_args_list[0].kwargs == {
        "dsn": "postgresql://test",
        "timeout": 5,
    }
    sleep.assert_awaited_once_with(0.25)


@pytest.mark.asyncio
async def test_database_connect_does_not_retry_authentication_failure():
    connect = AsyncMock(
        side_effect=asyncpg.InvalidPasswordError("password authentication failed")
    )

    with (
        patch("routers.auth.asyncpg.connect", new=connect),
        patch("routers.auth.asyncio.sleep", new_callable=AsyncMock) as sleep,
        pytest.raises(asyncpg.InvalidPasswordError),
    ):
        await _connect_db("postgresql://test")

    connect.assert_awaited_once()
    sleep.assert_not_awaited()
