from __future__ import annotations

import asyncio
from typing import Annotated, Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from routers.auth import get_db, require_admin_xa, require_authenticated_user
from services.logger import get_logger
from services.notifications import notify_user
from services.rate_limit import limiter
from services.supabase_admin import UserProfile

_log = get_logger(__name__)
router = APIRouter(prefix="/push", tags=["push"])
api_router = APIRouter(tags=["notifications"])


class NotifyVillagesRequest(BaseModel):
    villages: list[UUID] = Field(min_length=1, max_length=100)
    period_name: str = Field(min_length=1, max_length=120)
    deadline: str = Field(min_length=1, max_length=40)
    template_name: str | None = Field(default=None, max_length=255)
    origin: str | None = Field(default=None, max_length=500)


class TestPushRequest(BaseModel):
    user_id: UUID
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=1000)
    url: str | None = Field(default=None, max_length=500)


@router.post("/notify-villages")
@limiter.limit("10/minute")
async def notify_villages(
    request: Request,
    payload: NotifyVillagesRequest,
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)],
) -> dict[str, Any]:
    """Queue in-app/Web Push delivery for officers in selected villages."""
    rows = await conn.fetch(
        """
        SELECT target.id::text AS id
        FROM user_profiles AS target
        JOIN villages AS village ON village.id = target.village_id
        JOIN user_profiles AS actor ON actor.id = $2::uuid
        WHERE target.village_id = ANY($1::uuid[])
          AND target.role IN ('can_bo_thon', 'to_cnscd')
          AND target.is_active = TRUE
          AND target.commune_id = actor.commune_id
          AND village.commune_id = actor.commune_id
        """,
        [str(village) for village in payload.villages],
        admin.id,
    )
    title = f"Kỳ báo cáo mới: {payload.period_name}"
    body = f"UBND xã đã tạo kỳ báo cáo mới. Hạn nộp: {payload.deadline}."
    url = "/?tab=report-form"
    results = await asyncio.gather(
        *(
            notify_user(user_id=str(row["id"]), title=title, body=body, url=url)
            for row in rows
        ),
        return_exceptions=True,
    )
    failed = sum(1 for result in results if isinstance(result, Exception) or result is False)
    if failed:
        _log.warning(
            "Some notification deliveries failed",
            extra={"attempted": len(results), "failed": failed},
        )
    return {"success": failed == 0, "notified_count": len(results) - failed, "failed_count": failed}


@router.post("/send-test")
@limiter.limit("10/minute")
async def send_test_push(
    request: Request,
    payload: TestPushRequest,
    admin: Annotated[UserProfile, Depends(require_admin_xa)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)],
) -> dict[str, bool]:
    target_is_scoped = await conn.fetchval(
        """
        SELECT EXISTS (
          SELECT 1
          FROM user_profiles AS target
          JOIN user_profiles AS actor ON actor.id = $2::uuid
          WHERE target.id = $1::uuid
            AND target.commune_id = actor.commune_id
            AND target.is_active = TRUE
        )
        """,
        payload.user_id,
        admin.id,
    )
    if not target_is_scoped:
        raise HTTPException(status_code=404, detail="Notification target not found")
    delivered = await notify_user(
        user_id=str(payload.user_id),
        title=payload.title,
        body=payload.body,
        url=payload.url,
    )
    if not delivered:
        raise HTTPException(status_code=503, detail="Notification was not delivered")
    return {"success": True}


@api_router.get("/notifications")
async def list_notifications(
    current_user: Annotated[UserProfile, Depends(require_authenticated_user)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)],
) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id, title, body, url, is_read, created_at, read_at
        FROM notifications
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 50
        """,
        current_user.id,
    )
    return [dict(row) for row in rows]


@api_router.post("/notifications/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: UUID,
    current_user: Annotated[UserProfile, Depends(require_authenticated_user)],
    conn: Annotated[asyncpg.Connection, Depends(get_db)],
) -> dict[str, bool]:
    updated = await conn.fetchval(
        """
        UPDATE notifications
        SET is_read = TRUE, read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2::uuid
        RETURNING id
        """,
        notification_id,
        current_user.id,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return {"success": True}


__all__ = ["api_router", "router"]
