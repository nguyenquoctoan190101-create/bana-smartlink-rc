"""
tests/conftest.py
==================
Cài đặt toàn cục cho bộ thử nghiệm.

Stub các native driver (asyncpg) và các client bên ngoài (httpx)
để test chạy được trong môi trường CI/CD không có kết nối DB hay mạng thật.
Tất cả stub được đưa vào sys.modules TRƯỚC KHI bất kỳ module nào của ứng dụng
được import, đảm bảo không có ImportError ở cấp module-level.
"""
from __future__ import annotations

import sys
import types


def _make_asyncpg_stub() -> types.ModuleType:
    """Tạo stub tối thiểu cho asyncpg đủ để import services/chatbot.py."""
    mod = types.ModuleType("asyncpg")
    mod.__version__ = "0.0.0-stub"

    class _FakeConnection:
        async def fetch(self, *a, **kw):
            return []
        async def fetchrow(self, *a, **kw):
            return None
        async def fetchval(self, *a, **kw):
            return None
        async def execute(self, *a, **kw):
            return None
        async def close(self):
            pass

    class _FakePool:
        async def acquire(self):
            return _FakeConnection()
        async def release(self, conn):
            pass
        async def close(self):
            pass

    class PostgresError(Exception):
        pass

    async def create_pool(*a, **kw):
        return _FakePool()

    async def connect(*a, **kw):
        return _FakeConnection()

    mod.Connection = _FakeConnection
    mod.Pool = _FakePool
    mod.PostgresError = PostgresError
    mod.create_pool = create_pool
    mod.connect = connect
    return mod


# Stub only when the real driver is unavailable.  Unconditional replacement
# used to hide invalid DSNs and SQL/API drift in every test process.
try:
    import asyncpg as _asyncpg  # noqa: F401
except ImportError:
    sys.modules["asyncpg"] = _make_asyncpg_stub()


import pytest  # noqa: E402 -- external-driver stubs must be installed first
from services.rate_limit import limiter  # noqa: E402 -- see stub bootstrap above


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Tự động reset in-memory storage của slowapi trước mỗi test để tránh rò rỉ quota."""
    limiter.reset()
