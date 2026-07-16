"""services/chatbot.py
=======================
Chatbot Q&A tiếng Việt cho Ba Na SmartLink.

Kiến trúc
---------
1. ``ask_question_async`` nhận câu hỏi tiếng Việt tự do.
2. ``_classify_question`` phân loại câu hỏi thành ``_QueryIntent`` bằng
   heuristic từ khoá — không dùng LLM.
3. ``_fetch_context`` chạy truy vấn SQL tham số hoá trên PostgreSQL và trả về
   **chỉ số liệu tổng hợp cấp thôn**.  Các cột dữ liệu cá nhân
   (submitted_by_name, submitted_by_phone, proposed_by …) KHÔNG BAO GIỜ được
   chọn.
4. JSON tổng hợp được gửi cho Gemini 2.5 Flash kèm system prompt nghiêm cấm
   bịa đặt số liệu.  Gemini chỉ được phép diễn giải những gì đã có trong
   context.

Đảm bảo quyền riêng tư
-----------------------
* Không có tên, số điện thoại hoặc PII nào được đưa vào payload Gemini.
* Hằng số ``GEMINI_SYSTEM_PROMPT`` mã hoá ràng buộc này vào lệnh cho model.

Đảm bảo số liệu trung thực
---------------------------
* Tất cả số liệu đến từ PostgreSQL.  Gemini nhận chúng dưới dạng JSON
  có cấu trúc và chỉ được phép diễn đạt bằng ngôn ngữ tự nhiên.
* ``temperature=0.0`` giảm thiểu sáng tạo ngoài dữ liệu.
"""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any

import asyncpg

from services.gemini import GeminiError, get_gemini_client
from services.settings import load_settings

# ---------------------------------------------------------------------------
# Hằng số
# ---------------------------------------------------------------------------

RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"
PUBLIC_CT_CODES = ("CT01", "CT02", "CT09", "CT12", "CT13")
_PUBLIC_CT_SQL = "('CT01','CT02','CT09','CT12','CT13')"

# System prompt gửi kèm MỌI lần gọi Gemini.
# Model bị cấm tuyệt đối bịa số liệu hoặc suy diễn ngoài context.
GEMINI_SYSTEM_PROMPT = (
    "Bạn là trợ lý hành chính của hệ thống Ba Na SmartLink. "
    "Chỉ trả lời dựa trên dữ liệu được cung cấp trong ngữ cảnh JSON, "
    "không tự suy diễn, không thêm bất kỳ số liệu nào ngoài dữ liệu đã cho. "
    "Nếu không có dữ liệu phù hợp trong ngữ cảnh, hãy trả lời rõ ràng: "
    "\'Chưa có thông tin về nội dung này trong hệ thống.\' "
    "Không bao giờ đề xuất hoặc suy đoán số liệu từ kiến thức bên ngoài."
)

_MAX_OUTPUT_TOKENS = 400  # đủ cho một đoạn ngắn gọn
_GEMINI_TEMPERATURE = 0.0  # deterministic — số liệu phải chính xác

# ---------------------------------------------------------------------------
# Metadata chỉ tiêu (nạp một lần từ config)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Indicator:
    code: str
    name: str
    unit: str


def _load_indicators() -> list[_Indicator]:
    with RULES_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    return [
        _Indicator(
            code=str(i["code"]),
            name=str(i["name"]),
            unit=str(i["unit"]),
        )
        for i in payload.get("indicators", [])
        if isinstance(i, dict)
    ]


_INDICATORS: list[_Indicator] = _load_indicators()
_CODE_TO_INDICATOR: dict[str, _Indicator] = {ind.code: ind for ind in _INDICATORS}

# ---------------------------------------------------------------------------
# Phân loại ý định — heuristic từ khoá thuần tuý, không dùng LLM
# ---------------------------------------------------------------------------


class _QueryIntent(Enum):
    HELP = auto()                # "Bạn biết những gì?" / "Tôi cần hỏi thế nào?"
    VILLAGE_INDICATOR = auto()   # "Thôn X có bao nhiêu hộ nghèo?"
    VILLAGE_ALL_STATS = auto()   # "Cho tôi xem tất cả chỉ tiêu thôn X"
    COMPARE_VILLAGES = auto()    # "So sánh hộ nghèo giữa thôn A và thôn B"
    PERIOD_SUMMARY = auto()      # "Toàn xã kỳ này có bao nhiêu hộ nghèo?"
    SUBMISSION_STATUS = auto()   # "Thôn nào chưa nộp báo cáo?"
    UNKNOWN = auto()


# Từ khoá → mã chỉ tiêu (sau khi chuẩn hoá bỏ dấu).
# Chỉ dùng cụm từ đủ dài để tránh khớp nhầm.
_KEYWORD_TO_CT: dict[str, str] = {
    "ho dan": "CT01",
    "tong ho": "CT01",
    "nhan khau": "CT02",
    "dan so": "CT02",
    "ho ngheo": "CT03",
    "so ho ngheo": "CT03",
    "can ngheo": "CT04",
    "ho can ngheo": "CT04",
    "nguoi co cong": "CT05",
    "co cong voi cach mang": "CT05",
    "bao tro xa hoi": "CT06",
    "doi tuong bao tro": "CT06",
    "tro cap xa hoi": "CT06",
    "tre em duoi 16": "CT07",
    "tre em duoi muoi sau": "CT07",
    "hoan canh dac biet": "CT08",
    "tre em hoan canh": "CT08",
    "gia dinh van hoa": "CT09",
    "dat gia dinh van hoa": "CT09",
    "lao dong": "CT10",
    "nguoi lao dong": "CT10",
    "bhyt": "CT11",
    "bao hiem y te": "CT11",
    "tham gia bhyt": "CT11",
    "to cnscd": "CT12",
    "cong nghe so cong dong": "CT12",
    "cong nghe so": "CT12",
    "dvc truc tuyen": "CT13",
    "dich vu cong truc tuyen": "CT13",
    "dich vu cong": "CT13",
    "bao luc gia dinh": "CT14",
    "vu bao luc": "CT14",
}

# Các từ khoá sau dùng word-boundary regex, không dùng substring 'in'
_SUBMISSION_PHRASE_RE = re.compile(
    r"\b(chua nop|nop bao cao|da nop|chua bao cao|tre han|dung han|trang thai nop)\b"
)
_COMPARE_PHRASE_RE = re.compile(
    # Cụm từ so sánh rõ ràng hoặc "hơn" đứng như một token độc lập
    r"\b(so sanh|so voi|it hon|nhieu hon|cao hon|thap hon)\b"
    r"|\bhon\b"   # "hơn" độc lập — đủ để nhận diện câu so sánh
)
_SUMMARY_PHRASE_RE = re.compile(
    r"\b(toan xa|tong cong|tat ca cac thon|ca xa|toan bo xa)\b"
)
_HELP_PHRASE_RE = re.compile(
    r"\b(ban biet gi|co the hoi gi|toi can hoi the nao|hoi nhu the nao"
    r"|huong dan hoi|huong dan su dung|ban lam duoc gi|tro giup)\b"
)


@dataclass
class _ParsedQuestion:
    intent: _QueryIntent
    village_names: list[str] = field(default_factory=list)
    ct_code: str | None = None
    period_name: str | None = None


def _strip_accents(text: str) -> str:
    """Bỏ dấu tiếng Việt và chuyển về chữ thường để so sánh từ khoá."""
    nfd = unicodedata.normalize("NFD", text)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").lower()


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", _strip_accents(text).strip())


def _extract_village_names_raw(text: str) -> list[str]:
    """Trích xuất tên thôn theo đúng dạng được lưu trong cơ sở dữ liệu.

    Dừng trước các từ chức năng (có, và, với, nào, là, không, phải, ...)
    để tránh bắt cả câu hỏi vào tên thôn.
    """
    matches = re.findall(
        r"[Tt]h[\xf4o][nN]\s+([\w\d][\w\s\d/]{0,40}?)"
        r"(?=\s+(?:c[\xf3o]\b|v[\xe0a]\b|n[\xe0a]o\b|l[\xe0a]\b|v[\u1edbi]\b"
        r"|kh[\xf4o]ng\b|ph[\u1ea3a]i\b|th[\xec]\b|h[\u01a1o]n\b)|\s*[,?]|$)",
        text,
        flags=re.UNICODE,
    )
    # Regex intentionally captures only the part after ``Thôn``.  Database
    # rows, however, use the canonical full name (for example
    # ``Thôn An Sơn``).  Returning the bare suffix caused every
    # village-specific chatbot query to miss its row.
    return [
        f"Thôn {match.strip()}"
        for match in matches
        if (
            match.strip()
            and len(match.strip()) <= 40
            and _normalise(match) not in {"toi", "minh", "cua toi", "cua minh"}
        )
    ]


def _extract_period_name(text: str) -> str | None:
    """Trích xuất 'tháng MM/YYYY' hoặc 'quý Q/YYYY' từ câu hỏi."""
    m = re.search(
        r"(th[a\xe1][nN]g\s+\d{1,2}/\d{4}|qu[y\xfd]\s+[1-4]/\d{4}|k[y\xfd]\s+\d{1,2}/\d{4})",
        text,
        flags=re.IGNORECASE,
    )
    return m.group(0).strip() if m else None


def _detect_ct_code(norm: str) -> str | None:
    """Tìm mã chỉ tiêu từ văn bản đã chuẩn hoá."""
    # Ưu tiên khớp dài trước (tránh "nghèo" khớp trước "hộ nghèo")
    for kw in sorted(_KEYWORD_TO_CT, key=len, reverse=True):
        if kw in norm:
            return _KEYWORD_TO_CT[kw]
    return None


def _classify_question(question: str) -> _ParsedQuestion:
    norm = _normalise(question)

    if _HELP_PHRASE_RE.search(norm):
        intent = _QueryIntent.HELP
    elif _COMPARE_PHRASE_RE.search(norm):
        intent = _QueryIntent.COMPARE_VILLAGES
    elif _SUBMISSION_PHRASE_RE.search(norm):
        intent = _QueryIntent.SUBMISSION_STATUS
    elif _SUMMARY_PHRASE_RE.search(norm):
        intent = _QueryIntent.PERIOD_SUMMARY
    elif "thon" in norm and (
        "tat ca" in norm or "toan bo" in norm or "cac chi tieu" in norm
    ):
        intent = _QueryIntent.VILLAGE_ALL_STATS
    else:
        ct = _detect_ct_code(norm)
        intent = _QueryIntent.VILLAGE_INDICATOR if ct else _QueryIntent.UNKNOWN

    village_names = _extract_village_names_raw(question)
    period = _extract_period_name(question)
    ct_code = _detect_ct_code(norm)

    return _ParsedQuestion(
        intent=intent,
        village_names=village_names,
        ct_code=ct_code,
        period_name=period,
    )


def _guidance_answer(caller_role: str) -> str:
    """Return safe usage guidance without calling the model or database."""
    if caller_role == "dan":
        return (
            "Tôi hỗ trợ tra cứu 5 chỉ tiêu đã được công bố: tổng số hộ dân, "
            "tổng số nhân khẩu, gia đình văn hóa, thành viên Tổ công nghệ số "
            "cộng đồng và lượt hướng dẫn dịch vụ công trực tuyến. "
            "Bạn hãy nêu rõ tên thôn, ví dụ: “Thôn Phú Hòa có bao nhiêu hộ dân?” "
            "hoặc hỏi “Toàn xã có bao nhiêu nhân khẩu?”."
        )
    return (
        "Tôi hỗ trợ tra cứu chỉ tiêu báo cáo trong đúng phạm vi tài khoản của bạn, "
        "so sánh thôn, tình trạng nộp báo cáo và số liệu toàn xã nếu vai trò cho phép. "
        "Ví dụ: “Thôn tôi có bao nhiêu hộ nghèo?”, “Thôn nào chưa nộp báo cáo kỳ này?” "
        "hoặc “So sánh hộ dân giữa Thôn An Sơn và Thôn Phú Hòa?”."
    )


def _public_scope_answer() -> str:
    return (
        "Chỉ tiêu này không thuộc phạm vi dữ liệu công khai. "
        "Cổng người dân chỉ cho phép tra cứu CT01, CT02, CT09, CT12 và CT13; "
        "CT14 và dữ liệu nhận diện cá nhân không bao giờ được trả về công khai."
    )


# ---------------------------------------------------------------------------
# Truy vấn PostgreSQL — chỉ số liệu tổng hợp, KHÔNG CÓ cột PII
# ---------------------------------------------------------------------------


async def _query_village_indicator(
    conn: asyncpg.Connection,
    village_names: list[str],
    ct_code: str,
    period_name: str | None,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
) -> list[dict[str, Any]]:
    """Giá trị chỉ tiêu cho một hoặc nhiều thôn.

    Cột được chọn: tên thôn, tên kỳ, mã chỉ tiêu, giá trị, trạng thái.
    Không có submitted_by_name, submitted_by_phone hay bất kỳ PII nào.
    """
    if caller_role == "dan" and ct_code not in PUBLIC_CT_CODES:
        return []

    conditions = ["rv.ct_code = $1"]
    params: list[Any] = [ct_code]
    idx = 2

    if village_names:
        ph = ", ".join(f"${i}" for i in range(idx, idx + len(village_names)))
        conditions.append(f"LOWER(v.name) IN ({ph})")
        params.extend(n.lower() for n in village_names)
        idx += len(village_names)

    if period_name:
        conditions.append(f"LOWER(rp.name) = ${idx}")
        params.append(period_name.lower())
        idx += 1

    if xa_id:
        conditions.append(f"v.commune_id = ${idx}")
        params.append(xa_id)
        idx += 1

    if caller_role == "dan":
        conditions.append("r.publication_status = 'published'")
    elif caller_role in {"can_bo_thon", "to_cnscd"}:
        if not caller_village_id:
            return []
        conditions.append(f"v.id = ${idx}")
        params.append(caller_village_id)

    where = " AND ".join(conditions)
    sql = f"""
        SELECT
            v.name         AS village_name,
            rp.name        AS period_name,
            rv.ct_code     AS ct_code,
            rv.value       AS value,
            r.workflow_status AS status
        FROM report_values rv
        JOIN reports r         ON r.id = rv.report_id
        JOIN villages v        ON v.id = r.village_id
        JOIN report_periods rp ON rp.id = r.period_id
        WHERE {where}
        ORDER BY rp.name DESC, v.name
        LIMIT 50
    """
    rows = await conn.fetch(sql, *params)
    return [dict(row) for row in rows]


async def _query_village_all_stats(
    conn: asyncpg.Connection,
    village_names: list[str],
    period_name: str | None,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
) -> list[dict[str, Any]]:
    """Tất cả chỉ tiêu CT01-CT14 của một hoặc nhiều thôn."""
    conditions: list[str] = []
    params: list[Any] = []
    idx = 1

    if village_names:
        ph = ", ".join(f"${i}" for i in range(idx, idx + len(village_names)))
        conditions.append(f"LOWER(v.name) IN ({ph})")
        params.extend(n.lower() for n in village_names)
        idx += len(village_names)

    if period_name:
        conditions.append(f"LOWER(rp.name) = ${idx}")
        params.append(period_name.lower())
        idx += 1

    if xa_id:
        conditions.append(f"v.commune_id = ${idx}")
        params.append(xa_id)
        idx += 1

    if caller_role == "dan":
        conditions.append(f"rv.ct_code IN {_PUBLIC_CT_SQL}")
        conditions.append("r.publication_status = 'published'")
    elif caller_role in {"can_bo_thon", "to_cnscd"}:
        if not caller_village_id:
            return []
        conditions.append(f"v.id = ${idx}")
        params.append(caller_village_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"""
        SELECT
            v.name         AS village_name,
            rp.name        AS period_name,
            rv.ct_code     AS ct_code,
            rv.value       AS value,
            r.workflow_status AS status
        FROM report_values rv
        JOIN reports r         ON r.id = rv.report_id
        JOIN villages v        ON v.id = r.village_id
        JOIN report_periods rp ON rp.id = r.period_id
        {where}
        ORDER BY rp.name DESC, v.name, rv.ct_code
        LIMIT 200
    """
    rows = await conn.fetch(sql, *params)
    return [dict(row) for row in rows]


async def _query_submission_status(
    conn: asyncpg.Connection,
    period_name: str | None,
    xa_id: str | None,
    caller_role: str,
    caller_village_id: str | None,
) -> list[dict[str, Any]]:
    """Trạng thái nộp báo cáo theo thôn — không có danh tính người nộp."""
    conditions: list[str] = []
    params: list[Any] = []
    idx = 1

    if period_name:
        conditions.append(f"LOWER(rp.name) = ${idx}")
        params.append(period_name.lower())
        idx += 1

    if xa_id:
        conditions.append(f"v.commune_id = ${idx}")
        params.append(xa_id)
        idx += 1

    if caller_role in {"can_bo_thon", "to_cnscd"}:
        if not caller_village_id:
            return []
        conditions.append(f"v.id = ${idx}")
        params.append(caller_village_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    # submitted_at chỉ lấy ::date — không tiết lộ thời điểm chính xác
    sql = f"""
        SELECT
            v.name                 AS village_name,
            rp.name                AS period_name,
            r.workflow_status      AS status,
            r.submitted_at::date   AS submitted_date
        FROM reports r
        JOIN villages v        ON v.id = r.village_id
        JOIN report_periods rp ON rp.id = r.period_id
        {where}
        ORDER BY rp.name DESC, r.workflow_status, v.name
        LIMIT 100
    """
    rows = await conn.fetch(sql, *params)
    return [dict(row) for row in rows]


async def _query_period_summary(
    conn: asyncpg.Connection,
    ct_code: str | None,
    period_name: str | None,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
) -> list[dict[str, Any]]:
    """Tổng cộng toàn xã theo một hoặc tất cả chỉ tiêu cho một kỳ."""
    if caller_role == "dan" and ct_code and ct_code not in PUBLIC_CT_CODES:
        return []

    conditions: list[str] = []
    params: list[Any] = []
    idx = 1

    if ct_code:
        conditions.append(f"rv.ct_code = ${idx}")
        params.append(ct_code)
        idx += 1
    elif caller_role == "dan":
        conditions.append(f"rv.ct_code IN {_PUBLIC_CT_SQL}")

    if period_name:
        conditions.append(f"LOWER(rp.name) = ${idx}")
        params.append(period_name.lower())
        idx += 1

    if xa_id:
        conditions.append(f"v.commune_id = ${idx}")
        params.append(xa_id)
        idx += 1

    if caller_role == "dan":
        conditions.append("r.publication_status = 'published'")
    elif caller_role in {"can_bo_thon", "to_cnscd"}:
        if not caller_village_id:
            return []
        conditions.append(f"v.id = ${idx}")
        params.append(caller_village_id)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"""
        SELECT
            rp.name                      AS period_name,
            rv.ct_code                   AS ct_code,
            SUM(rv.value)                AS total_value,
            COUNT(DISTINCT r.village_id) AS village_count
        FROM report_values rv
        JOIN reports r         ON r.id = rv.report_id
        JOIN villages v        ON v.id = r.village_id
        JOIN report_periods rp ON rp.id = r.period_id
        {where}
        GROUP BY rp.name, rv.ct_code
        ORDER BY rp.name DESC, rv.ct_code
        LIMIT 100
    """
    rows = await conn.fetch(sql, *params)
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Xây dựng context cho Gemini — chỉ số liệu tổng hợp
# ---------------------------------------------------------------------------


def _enrich_with_indicator_names(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Thêm indicator_name và unit cho mỗi hàng có ct_code."""
    enriched = []
    for row in rows:
        r = dict(row)
        code = r.get("ct_code")
        if code and code in _CODE_TO_INDICATOR:
            ind = _CODE_TO_INDICATOR[code]
            r["indicator_name"] = ind.name
            r["unit"] = ind.unit
        enriched.append(r)
    return enriched


def _build_gemini_prompt(
    question: str,
    context_rows: list[dict[str, Any]],
) -> str:
    """Xây dựng prompt cho Gemini chỉ chứa số liệu tổng hợp an toàn.

    Gemini không nhận được bất kỳ thông tin cá nhân nào.
    GEMINI_SYSTEM_PROMPT được gửi riêng qua systemInstruction.
    """
    enriched = _enrich_with_indicator_names(context_rows)
    # json.dumps với default=str để xử lý datetime an toàn
    safe_context = json.dumps(
        {
            "cau_hoi": question,
            "du_lieu_he_thong": enriched,
        },
        ensure_ascii=False,
        default=str,
    )
    return (
        "Dưới đây là câu hỏi của người dùng và dữ liệu từ hệ thống Ba Na SmartLink.\n"
        "Hãy trả lời câu hỏi bằng tiếng Việt, ngắn gọn và chính xác, "
        "CHỈ sử dụng các số liệu có trong trường \'du_lieu_he_thong\'. "
        "Nếu không có dữ liệu liên quan, nói rõ là chưa có thông tin.\n\n"
        f"{safe_context}"
    )


# ---------------------------------------------------------------------------
# Dispatcher nội bộ
# ---------------------------------------------------------------------------


async def _fetch_context(
    conn: asyncpg.Connection,
    parsed: _ParsedQuestion,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
) -> list[dict[str, Any]]:
    """Gọi đúng hàm truy vấn dựa trên intent đã phân loại."""
    intent = parsed.intent

    if intent == _QueryIntent.VILLAGE_INDICATOR and parsed.ct_code:
        return await _query_village_indicator(
            conn,
            village_names=parsed.village_names,
            ct_code=parsed.ct_code,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
        )

    if intent in (_QueryIntent.VILLAGE_ALL_STATS, _QueryIntent.COMPARE_VILLAGES):
        return await _query_village_all_stats(
            conn,
            village_names=parsed.village_names,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
        )

    if intent == _QueryIntent.SUBMISSION_STATUS:
        if caller_role == "dan":
            return []
        return await _query_submission_status(
            conn,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
        )

    if intent == _QueryIntent.PERIOD_SUMMARY:
        return await _query_period_summary(
            conn,
            ct_code=parsed.ct_code,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
        )

    # UNKNOWN nhưng có tên thôn → thử lấy tất cả chỉ tiêu
    if parsed.village_names:
        return await _query_village_all_stats(
            conn,
            village_names=parsed.village_names,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
        )

    # Không xác định được → trả về rỗng; Gemini sẽ nói "chưa có thông tin"
    return []


# ---------------------------------------------------------------------------
# API công khai
# ---------------------------------------------------------------------------


class ChatbotError(RuntimeError):
    """Raised when the chatbot cannot produce a safe answer."""


@dataclass(frozen=True)
class ChatbotAnswer:
    """Kết quả trả về từ chatbot."""
    question: str
    answer: str
    intent: str
    rows_retrieved: int


async def ask_question_async(
    question: str,
    *,
    xa_id: str | None = None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
    db_pool: asyncpg.Pool | None = None,
) -> ChatbotAnswer:
    """Trả lời câu hỏi tiếng Việt bằng dữ liệu PostgreSQL + diễn giải Gemini.

    Parameters
    ----------
    question:
        Câu hỏi tiếng Việt tự do của người dùng.
    xa_id:
        ID xã (tuỳ chọn) để giới hạn truy vấn trong một xã.
    caller_role:
        Vai trò người hỏi — backend tự xác định từ JWT, KHÔNG tin client gửi.
        Mặc định "dan" (hạn chế nhất). CT14 chỉ trả khi role != "dan".
    db_pool:
        asyncpg pool (tuỳ chọn, tái sử dụng giữa các request).
        Nếu None, một kết nối mới sẽ được tạo từ settings.database_url.

    Returns
    -------
    ChatbotAnswer
        Chứa câu trả lời đã diễn giải, nhãn intent và số hàng truy vấn.

    Đảm bảo quyền riêng tư
    -----------------------
    Không có PII (submitted_by_name, submitted_by_phone, proposed_by)
    nào được lấy từ DB hoặc gửi cho Gemini.
    Chỉ số liệu tổng hợp cấp thôn được sử dụng.
    """
    if not question or not question.strip():
        raise ChatbotError("Câu hỏi không được để trống.")

    parsed = _classify_question(question)

    if parsed.intent in {_QueryIntent.HELP, _QueryIntent.UNKNOWN}:
        return ChatbotAnswer(
            question=question,
            answer=_guidance_answer(caller_role),
            intent=parsed.intent.name,
            rows_retrieved=0,
        )

    if caller_role == "dan" and parsed.ct_code and parsed.ct_code not in PUBLIC_CT_CODES:
        return ChatbotAnswer(
            question=question,
            answer=_public_scope_answer(),
            intent=parsed.intent.name,
            rows_retrieved=0,
        )

    if (
        caller_role == "dan"
        and parsed.intent == _QueryIntent.VILLAGE_INDICATOR
        and not parsed.village_names
    ):
        return ChatbotAnswer(
            question=question,
            answer=(
                "Bạn vui lòng nêu rõ tên thôn cần tra cứu, ví dụ: "
                "“Thôn Phú Hòa có bao nhiêu hộ dân?”."
            ),
            intent=parsed.intent.name,
            rows_retrieved=0,
        )

    conn: asyncpg.Connection | None = None
    try:
        if db_pool is not None:
            conn = await db_pool.acquire()
        else:
            settings = load_settings()
            if not settings.database_url:
                raise ChatbotError("Cơ sở dữ liệu chưa được cấu hình.")
            conn = await asyncpg.connect(dsn=settings.database_url, statement_cache_size=0)

        context_rows = await _fetch_context(
            conn,
            parsed,
            xa_id,
            caller_role,
            caller_village_id,
        )
    except asyncpg.PostgresError as exc:
        raise ChatbotError("Không thể truy vấn cơ sở dữ liệu.") from exc
    finally:
        if conn is not None:
            if db_pool is not None:
                await db_pool.release(conn)
            else:
                await conn.close()

    prompt = _build_gemini_prompt(question, context_rows)

    try:
        answer_text = await get_gemini_client().generate_text(
            GEMINI_SYSTEM_PROMPT,
            prompt,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            temperature=_GEMINI_TEMPERATURE,
        )
    except GeminiError as exc:
        raise ChatbotError("Không thể tạo câu trả lời từ Gemini.") from exc

    return ChatbotAnswer(
        question=question,
        answer=answer_text.strip(),
        intent=parsed.intent.name,
        rows_retrieved=len(context_rows),
    )


def ask_question(
    question: str,
    *,
    xa_id: str | None = None,
) -> ChatbotAnswer:
    """Wrapper đồng bộ — chỉ dùng ngoài event loop đang chạy."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(ask_question_async(question, xa_id=xa_id))

    raise ChatbotError("Dùng ask_question_async trong môi trường async.")


# ---------------------------------------------------------------------------
# Tóm tắt tường thuật dashboard (API tương thích ngược)
# ---------------------------------------------------------------------------

# Alias để không phá vỡ bất kỳ import nào đang dùng NARRATIVE_SYSTEM_PROMPT
NARRATIVE_SYSTEM_PROMPT = GEMINI_SYSTEM_PROMPT


async def generate_narrative_summary_async(period_id: str) -> str:
    """Tạo đoạn văn tóm tắt hành chính từ số liệu tổng hợp toàn xã.

    period_id được giữ để tương thích với router hiện tại nhưng không
    được gửi vào prompt hay dùng trong truy vấn PII.
    """
    settings = load_settings()
    if not settings.database_url:
        raise ChatbotError("Cơ sở dữ liệu chưa được cấu hình.")
    conn = await asyncpg.connect(dsn=settings.database_url, statement_cache_size=0)
    try:
        rows = await _query_period_summary(
            conn,
            ct_code=None,
            period_name=None,
            xa_id=None,
            caller_role="admin_xa",
        )
    except asyncpg.PostgresError as exc:
        raise ChatbotError("Không thể truy vấn dữ liệu tổng hợp.") from exc
    finally:
        await conn.close()

    enriched = _enrich_with_indicator_names(rows)
    context_json = json.dumps(
        {"du_lieu_tong_hop": enriched},
        ensure_ascii=False,
        default=str,
    )
    prompt = (
        "Viết một đoạn văn xuôi tiếng Việt khoảng 150 từ, giọng hành chính, "
        "dành cho lãnh đạo xã đọc nhanh. Không dùng gạch đầu dòng. "
        "Chỉ sử dụng dữ liệu JSON sau:\n"
        f"{context_json}"
    )

    try:
        narrative = await get_gemini_client().generate_text(
            GEMINI_SYSTEM_PROMPT,
            prompt,
            max_output_tokens=420,
            temperature=0.15,
        )
    except GeminiError as exc:
        raise ChatbotError("Không thể tạo tóm tắt tường thuật.") from exc

    return " ".join(narrative.strip().split())


def generate_narrative_summary(period_id: str) -> str:
    """Wrapper đồng bộ cho generate_narrative_summary_async."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(generate_narrative_summary_async(period_id))

    raise ChatbotError("Dùng generate_narrative_summary_async trong môi trường async.")


__all__ = [
    "ChatbotAnswer",
    "ChatbotError",
    "GEMINI_SYSTEM_PROMPT",
    "NARRATIVE_SYSTEM_PROMPT",
    "ask_question",
    "ask_question_async",
    "generate_narrative_summary",
    "generate_narrative_summary_async",
]
