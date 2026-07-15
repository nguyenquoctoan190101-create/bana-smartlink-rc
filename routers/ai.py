from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from routers.auth import get_optional_user
from services.chatbot import ChatbotError, ask_question_async
from services.rate_limit import limiter
from services.supabase_admin import UserProfile

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    xa_id: str | None = Field(default=None, max_length=64)


class ChatResponse(BaseModel):
    question: str
    answer: str
    intent: str
    rows_retrieved: int


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
    try:
        result = await ask_question_async(
            payload.question,
            xa_id=payload.xa_id,
            caller_role=caller_role,
            caller_village_id=current_user.village_id if current_user else None,
        )
    except ChatbotError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    return ChatResponse(
        question=result.question,
        answer=result.answer,
        intent=result.intent,
        rows_retrieved=result.rows_retrieved,
    )


__all__ = ["router"]
