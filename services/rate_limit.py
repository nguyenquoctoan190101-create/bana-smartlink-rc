from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address


# Shared limiter instance used by FastAPI and endpoint decorators.
limiter = Limiter(key_func=get_remote_address)


__all__ = ["limiter"]
