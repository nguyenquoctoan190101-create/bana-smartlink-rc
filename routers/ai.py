from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from routers.auth import get_optional_user
from services.chatbot import ChatbotError, ask_question_async
from services.rate_limit import limiter
from services.settings import load_settings
from services.supabase_admin import UserProfile

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=500)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    xa_id: str | None = Field(default=None, max_length=64)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=6)


class ChatSourceResponse(BaseModel):
    kind: Literal["report_data", "knowledge_article"]
    title: str
    scope: str
    period: str | None = None
    reference: str | None = None


class ChatResponse(BaseModel):
    question: str
    answer: str
    intent: str
    rows_retrieved: int
    sources: list[ChatSourceResponse] = Field(default_factory=list)
    as_of: str | None = None
    data_scope: str = "unavailable"
    limitations: list[str] = Field(default_factory=list)


class ChatCapabilitiesResponse(BaseModel):
    voice_enabled: bool


@router.get("/capabilities", response_model=ChatCapabilitiesResponse)
async def chat_capabilities() -> ChatCapabilitiesResponse:
    """Expose only non-sensitive UI capabilities used by the public widget."""

    return ChatCapabilitiesResponse(voice_enabled=bool(load_settings().feature_voice))


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("20/minute")
async def chat(
    request: Request,
    payload: ChatRequest,
    current_user: Annotated[UserProfile | None, Depends(get_optional_user)],
) -> ChatResponse:
    """Tra loi cau hoi tieng Viet bang du lieu PostgreSQL + Gemini.

    Tat ca so lieu tu PostgreSQL; Gemini chi dien giai.
    Khong bao gio gui PII (ten/SDT nguoi dan) vao prompt.
    """
    _ = request
    caller_role = current_user.role if current_user else "dan"
    configured_commune_id = load_settings().bana_commune_id
    authorized_commune_id = (
        current_user.commune_id if current_user else configured_commune_id
    )
    if not authorized_commune_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản chưa được gán phạm vi xã",
        )
    if payload.xa_id is not None and payload.xa_id != authorized_commune_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Không được truy cập dữ liệu ngoài phạm vi xã",
        )
    try:
        result = await ask_question_async(
            payload.question,
            xa_id=authorized_commune_id,
            caller_role=caller_role,
            caller_village_id=current_user.village_id if current_user else None,
            caller_user_id=current_user.id if current_user else None,
            history=[item.model_dump() for item in payload.history],
        )
    except ChatbotError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Dịch vụ trợ lý AI đang tạm thời không sẵn sàng",
        ) from exc

    return ChatResponse(
        question=result.question,
        answer=result.answer,
        intent=result.intent,
        rows_retrieved=result.rows_retrieved,
        sources=[
            ChatSourceResponse(
                kind=source.kind,
                title=source.title,
                scope=source.scope,
                period=source.period,
                reference=source.reference,
            )
            for source in result.sources
        ],
        as_of=result.as_of,
        data_scope=result.data_scope,
        limitations=list(result.limitations),
    )


__all__ = ["router"]
