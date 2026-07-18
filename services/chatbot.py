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
VILLAGE_MAP_PATH = (
    Path(__file__).resolve().parents[1]
    / "DU_LIEU_CHINH_THUC"
    / "village_merge_map_CHINH_THUC.json"
)
PUBLIC_CT_CODES = ("CT01", "CT02", "CT09", "CT12", "CT13")
_PUBLIC_CT_SQL = "('CT01','CT02','CT09','CT12','CT13')"
_CURRENT_VILLAGE_NAMES = (
    "Thôn An Sơn",
    "Thôn Hòa Ninh",
    "Thôn Hòa Nhơn",
    "Thôn Phú Hòa",
    "Thôn Phước Hưng",
    "Thôn Phước Khương",
    "Thôn Sơn Phước",
    "Thôn Thạch Nham Đông",
    "Thôn Thạch Nham Tây",
    "Thôn Thái Lai",
)

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
    OUT_OF_SCOPE = auto()        # Câu hỏi không liên quan dữ liệu BaNa SmartLink
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
    r"\b(ban biet gi|ban biet nhung gi|co the hoi gi|toi can hoi the nao|hoi nhu the nao"
    r"|huong dan hoi|huong dan su dung|ban lam duoc gi|tro giup)\b"
)
_OBVIOUS_OUT_OF_SCOPE_RE = re.compile(
    r"\b(thoi tiet|du bao mua|ngay mai co mua|gia vang|gia xang|ket qua bong da|"
    r"nau an|viet code|lap trinh|dich bai hat|tin tuc the gioi|tu van dau tu)\b"
)

_EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?<!\d)(?:\+84|0)\d{8,10}(?!\d)")
_LONG_ID_RE = re.compile(r"(?<!\d)\d{12}(?!\d)")

_NLU_SYSTEM_PROMPT = (
    "Bạn là bộ phân tích ý định cho BaNa SmartLink. Chỉ chuyển câu hỏi thành JSON; "
    "không trả lời, không suy đoán số liệu và không quyết định quyền truy cập. "
    "Chọn đúng một intent trong danh sách cho phép. Dùng NONE nếu không có mã chỉ tiêu. "
    "Tên thôn phải lấy nguyên văn từ danh sách cho phép."
)

_NLU_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "intent": {
            "type": "STRING",
            "enum": [
                "HELP",
                "OUT_OF_SCOPE",
                "VILLAGE_INDICATOR",
                "VILLAGE_ALL_STATS",
                "COMPARE_VILLAGES",
                "PERIOD_SUMMARY",
                "SUBMISSION_STATUS",
                "UNKNOWN",
            ],
        },
        "ct_code": {
            "type": "STRING",
            "enum": ["NONE", *[f"CT{i:02d}" for i in range(1, 15)]],
        },
        "village_names": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "maxItems": 10,
        },
        "period_name": {"type": "STRING", "maxLength": 64},
    },
    "required": ["intent", "ct_code", "village_names", "period_name"],
}


@dataclass
class _ParsedQuestion:
    intent: _QueryIntent
    village_names: list[str] = field(default_factory=list)
    ct_code: str | None = None
    period_name: str | None = None


def _strip_accents(text: str) -> str:
    """Bỏ dấu tiếng Việt và chuyển về chữ thường để so sánh từ khoá."""
    nfd = unicodedata.normalize("NFD", text)
    without_marks = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    # Vietnamese đ/Đ does not decompose under NFD.
    return without_marks.replace("đ", "d").replace("Đ", "D").lower()


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", _strip_accents(text).strip())


def _load_village_aliases() -> tuple[dict[str, str], set[str]]:
    """Load official old→new village names and pending mappings.

    The source document is deliberately treated as a routing aid only. A
    legacy name mapped to ``None`` is kept separate so the chatbot cannot
    silently aggregate a village before an official decision exists.
    """
    if not VILLAGE_MAP_PATH.exists():
        return {}, set()
    try:
        payload = json.loads(VILLAGE_MAP_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}, set()
    new_names = {
        str(item.get("id")): str(item.get("ten"))
        for item in payload.get("villages_moi", [])
        if isinstance(item, dict) and item.get("id") and item.get("ten")
    }
    aliases: dict[str, str] = {}
    pending: set[str] = set()
    for item in payload.get("anh_xa_thon_cu", []):
        if not isinstance(item, dict) or not item.get("ten_thon_cu"):
            continue
        alias = _normalise(str(item["ten_thon_cu"]))
        target_id = item.get("new_village_id")
        if target_id and target_id in new_names:
            aliases[alias] = new_names[target_id]
        else:
            pending.add(alias)
    return aliases, pending


_LEGACY_VILLAGE_ALIASES, _PENDING_VILLAGE_ALIASES = _load_village_aliases()


def _extract_village_names_raw(text: str) -> list[str]:
    """Trích xuất tên thôn theo đúng dạng được lưu trong cơ sở dữ liệu.

    Dừng trước các từ chức năng (có, và, với, nào, là, không, phải, ...)
    để tránh bắt cả câu hỏi vào tên thôn.
    """
    normalized_text = _normalise(text)
    canonical_matches = [
        village
        for village in _CURRENT_VILLAGE_NAMES
        if _normalise(village) in normalized_text
        or _normalise(village.removeprefix("Thôn ")) in normalized_text
    ]
    if canonical_matches:
        return canonical_matches

    legacy_matches = [
        target
        for alias, target in sorted(
            _LEGACY_VILLAGE_ALIASES.items(), key=lambda item: len(item[0]), reverse=True
        )
        if alias in normalized_text
    ]
    if legacy_matches:
        return list(dict.fromkeys(legacy_matches))

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
    explicit_code = re.search(r"\bct(?:0[1-9]|1[0-4])\b", norm)
    if explicit_code:
        return explicit_code.group(0).upper()

    # Ưu tiên khớp dài trước (tránh "nghèo" khớp trước "hộ nghèo")
    for kw in sorted(_KEYWORD_TO_CT, key=len, reverse=True):
        if kw in norm:
            return _KEYWORD_TO_CT[kw]
    for indicator in sorted(_INDICATORS, key=lambda item: len(item.name), reverse=True):
        indicator_name = _normalise(indicator.name)
        indicator_name = re.sub(r"^so |^tong so ", "", indicator_name)
        if indicator_name and indicator_name in norm:
            return indicator.code
    return None


def _classify_question(question: str) -> _ParsedQuestion:
    norm = _normalise(question)

    if _OBVIOUS_OUT_OF_SCOPE_RE.search(norm):
        intent = _QueryIntent.OUT_OF_SCOPE
    elif _HELP_PHRASE_RE.search(norm):
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


def _redact_free_text(text: str) -> str:
    """Remove common citizen identifiers before any model request."""
    redacted = _EMAIL_RE.sub("[EMAIL_REDACTED]", text)
    redacted = _PHONE_RE.sub("[PHONE_REDACTED]", redacted)
    return _LONG_ID_RE.sub("[ID_REDACTED]", redacted)


def _canonical_village_name(value: str) -> str | None:
    normalized = _normalise(value)
    normalized_without_prefix = re.sub(r"^thon\s+", "", normalized)
    for village in _CURRENT_VILLAGE_NAMES:
        candidate = _normalise(village)
        candidate_without_prefix = re.sub(r"^thon\s+", "", candidate)
        if normalized in {candidate, candidate_without_prefix}:
            return village
        if normalized_without_prefix == candidate_without_prefix:
            return village
    return None


def _mentions_pending_village_mapping(question: str) -> bool:
    normalized = _normalise(question)
    return any(alias in normalized for alias in _PENDING_VILLAGE_ALIASES)


async def _classify_question_with_gemini(
    question: str,
    history: list[dict[str, str]] | None,
) -> _ParsedQuestion | None:
    """Use Gemini only as a constrained NLU fallback.

    All returned fields are validated against backend allowlists. Model output
    never carries a role, a permission decision, SQL, or a final answer.
    """
    safe_history = [
        {
            "role": str(item.get("role", ""))[:16],
            "content": _redact_free_text(str(item.get("content", ""))[:500]),
        }
        for item in (history or [])[-6:]
        if item.get("role") in {"user", "assistant"}
    ]
    payload = {
        "question": _redact_free_text(question),
        "recent_history": safe_history,
        "allowed_villages": list(_CURRENT_VILLAGE_NAMES),
        "legacy_village_aliases": [
            {"old_name": alias, "new_name": target}
            for alias, target in _LEGACY_VILLAGE_ALIASES.items()
        ],
        "pending_village_names": list(_PENDING_VILLAGE_ALIASES),
        "allowed_indicators": [
            {"code": indicator.code, "name": indicator.name}
            for indicator in _INDICATORS
        ],
        "intent_meanings": {
            "HELP": "hỏi chatbot làm được gì hoặc cách hỏi",
            "OUT_OF_SCOPE": "không liên quan dữ liệu/báo cáo BaNa SmartLink",
            "VILLAGE_INDICATOR": "một chỉ tiêu của một hay nhiều thôn",
            "VILLAGE_ALL_STATS": "toàn bộ chỉ tiêu của một thôn",
            "COMPARE_VILLAGES": "so sánh các thôn",
            "PERIOD_SUMMARY": "tổng hợp toàn xã hoặc theo kỳ",
            "SUBMISSION_STATUS": "tiến độ/trạng thái nộp báo cáo",
            "UNKNOWN": "có vẻ liên quan nhưng thiếu thông tin để hiểu",
        },
    }
    try:
        result = await get_gemini_client().generate_json(
            _NLU_SYSTEM_PROMPT,
            json.dumps(payload, ensure_ascii=False),
            _NLU_RESPONSE_SCHEMA,
            max_output_tokens=256,
        )
    except GeminiError:
        return None

    intent_name = str(result.get("intent", "UNKNOWN")).upper()
    intent = _QueryIntent.__members__.get(intent_name, _QueryIntent.UNKNOWN)
    raw_code = str(result.get("ct_code", "NONE")).upper()
    ct_code = raw_code if raw_code in _CODE_TO_INDICATOR else None
    village_names: list[str] = []
    raw_villages = result.get("village_names")
    if isinstance(raw_villages, list):
        for raw_village in raw_villages[:10]:
            canonical = _canonical_village_name(str(raw_village))
            if canonical and canonical not in village_names:
                village_names.append(canonical)
    period_name = _extract_period_name(str(result.get("period_name", "")))
    return _ParsedQuestion(
        intent=intent,
        village_names=village_names,
        ct_code=ct_code,
        period_name=period_name,
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


def _out_of_scope_answer() -> str:
    return (
        "Câu hỏi này nằm ngoài phạm vi dữ liệu và báo cáo của BaNa SmartLink. "
        "Tôi không dùng kiến thức bên ngoài để suy đoán. Bạn có thể hỏi về chỉ tiêu "
        "theo thôn, số liệu toàn xã, kỳ báo cáo hoặc tiến độ nộp báo cáo nếu tài khoản "
        "của bạn có quyền xem."
    )


def _pending_village_mapping_answer() -> str:
    return (
        "Tên thôn này đang có phương án phân chia nhưng chưa có quyết định và số liệu "
        "chính thức để gộp vào thôn mới. Tôi không tự suy đoán; vui lòng hỏi lại sau "
        "khi UBND xã cập nhật phạm vi dữ liệu."
    )


def _no_data_answer(parsed: _ParsedQuestion, caller_role: str) -> str:
    scope = ", ".join(parsed.village_names) if parsed.village_names else "phạm vi đã hỏi"
    if caller_role == "dan":
        return (
            f"Chưa có dữ liệu đã công bố cho {scope}. "
            "Dữ liệu có thể chưa được công bố hoặc không thuộc phạm vi công khai; "
            "tôi không tự suy đoán giá trị."
        )
    return (
        f"Không tìm thấy dữ liệu trong phạm vi quyền của tài khoản cho {scope}. "
        "Hãy kiểm tra tên thôn, kỳ báo cáo hoặc trạng thái phân công."
    )


def _deterministic_data_answer(rows: list[dict[str, Any]]) -> str:
    """Keep known data questions usable when the optional model is unavailable."""
    snippets: list[str] = []
    for row in rows[:20]:
        village = str(row.get("village_name") or "Phạm vi đã chọn")
        period = str(row.get("period_name") or "kỳ dữ liệu chưa xác định")
        code = str(row.get("ct_code") or "chỉ tiêu")
        value = row.get("value")
        indicator = _CODE_TO_INDICATOR.get(code)
        unit = indicator.unit if indicator else ""
        if value is None:
            rendered = "chưa có dữ liệu"
        else:
            rendered = f"{value}{f' {unit}' if unit else ''}"
        snippets.append(f"{village}: {code} = {rendered} ({period})")
    return (
        "Kết quả từ dữ liệu đã được phân quyền: "
        + "; ".join(snippets)
        + ". Gemini hiện không sẵn sàng nên tôi hiển thị kết quả xác định, không suy diễn."
    )


# ---------------------------------------------------------------------------
# Truy vấn PostgreSQL — chỉ số liệu tổng hợp, KHÔNG CÓ cột PII
# ---------------------------------------------------------------------------


def _append_staff_scope(
    conditions: list[str],
    params: list[Any],
    idx: int,
    caller_role: str,
    caller_village_id: str | None,
    caller_user_id: str | None,
) -> int | None:
    """Append an explicit village scope; return None when scope is invalid."""
    if caller_role == "can_bo_thon":
        if not caller_village_id:
            return None
        conditions.append(f"v.id = ${idx}::uuid")
        params.append(caller_village_id)
        return idx + 1
    if caller_role == "to_cnscd":
        if not caller_user_id:
            return None
        conditions.append(
            "EXISTS ("
            "SELECT 1 FROM user_village_assignments chatbot_scope "
            f"WHERE chatbot_scope.user_id = ${idx}::uuid "
            "AND chatbot_scope.village_id = v.id"
            ")"
        )
        params.append(caller_user_id)
        return idx + 1
    return idx


async def _query_village_indicator(
    conn: asyncpg.Connection,
    village_names: list[str],
    ct_code: str,
    period_name: str | None,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
    caller_user_id: str | None = None,
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
        scoped_idx = _append_staff_scope(
            conditions,
            params,
            idx,
            caller_role,
            caller_village_id,
            caller_user_id,
        )
        if scoped_idx is None:
            return []
        idx = scoped_idx

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
    caller_user_id: str | None = None,
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
        scoped_idx = _append_staff_scope(
            conditions,
            params,
            idx,
            caller_role,
            caller_village_id,
            caller_user_id,
        )
        if scoped_idx is None:
            return []
        idx = scoped_idx

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
    caller_user_id: str | None,
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
        scoped_idx = _append_staff_scope(
            conditions,
            params,
            idx,
            caller_role,
            caller_village_id,
            caller_user_id,
        )
        if scoped_idx is None:
            return []
        idx = scoped_idx

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
    caller_user_id: str | None = None,
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
        scoped_idx = _append_staff_scope(
            conditions,
            params,
            idx,
            caller_role,
            caller_village_id,
            caller_user_id,
        )
        if scoped_idx is None:
            return []
        idx = scoped_idx

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
    resolved_villages: list[str] | None = None,
    knowledge_articles: list[dict[str, Any]] | None = None,
) -> str:
    """Xây dựng prompt cho Gemini chỉ chứa số liệu tổng hợp an toàn.

    Gemini không nhận được bất kỳ thông tin cá nhân nào.
    GEMINI_SYSTEM_PROMPT được gửi riêng qua systemInstruction.
    """
    enriched = _enrich_with_indicator_names(context_rows)
    # json.dumps với default=str để xử lý datetime an toàn
    safe_context = json.dumps(
        {
            "cau_hoi": _redact_free_text(question),
            "ten_thon_chuan_hoa": resolved_villages or [],
            "du_lieu_he_thong": enriched,
            "tai_lieu_da_duyet": knowledge_articles or [],
        },
        ensure_ascii=False,
        default=str,
    )
    return (
        "Dưới đây là câu hỏi của người dùng và dữ liệu từ hệ thống Ba Na SmartLink.\n"
        "Hãy trả lời câu hỏi bằng tiếng Việt, ngắn gọn và chính xác, "
        "CHỈ sử dụng các số liệu có trong trường \'du_lieu_he_thong\'. "
        "Nêu rõ thôn hoặc phạm vi, kỳ dữ liệu, mã/tên chỉ tiêu và nguồn là "
        "BaNa SmartLink khi các trường đó có trong dữ liệu. "
        "Nếu câu hỏi dùng tên thôn cũ nhưng trường 'ten_thon_chuan_hoa' hoặc "
        "'du_lieu_he_thong' dùng tên mới, hãy coi đó là cùng phạm vi và nói rõ "
        "tên chuẩn mới trong câu trả lời; không được kết luận là không có dữ liệu. "
        "Nếu không có dữ liệu liên quan, nói rõ là chưa có thông tin.\n\n"
        f"{safe_context}"
    )


# ---------------------------------------------------------------------------
# Tìm kiếm tài liệu nghiệp vụ đã duyệt (luôn giới hạn theo vai trò)
# ---------------------------------------------------------------------------

def _knowledge_audience(caller_role: str) -> str:
    return "public" if caller_role == "dan" else ("champions" if caller_role == "to_cnscd" else "internal")


def _knowledge_tokens(text: str) -> set[str]:
    normalized = _normalise(text)
    stop = {"cho", "bao", "nhung", "trong", "cua", "voi", "toi", "ban"}
    return {token for token in re.findall(r"[a-z0-9]{3,}", normalized) if token not in stop}


async def _fetch_knowledge_articles(
    conn: asyncpg.Connection,
    question: str,
    xa_id: str | None,
    caller_role: str,
) -> list[dict[str, Any]]:
    """Lấy bài viết approved cùng commune và audience; không đọc bản nháp."""
    rows = await conn.fetch(
        """
        select id, title, summary, body, category, audience, version, effective_from
        from public.knowledge_articles
        where commune_id = $1 and status = 'approved' and audience = $2
        order by updated_at desc
        limit 50
        """,
        xa_id or "ba_na",
        _knowledge_audience(caller_role),
    )
    question_tokens = _knowledge_tokens(question)
    ranked: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        article = dict(row)
        haystack = " ".join(str(article.get(key) or "") for key in ("title", "summary", "body"))
        overlap = len(question_tokens & _knowledge_tokens(haystack))
        if overlap:
            article["body"] = str(article.get("body") or "")[:6000]
            ranked.append((overlap, article))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [article for _, article in ranked[:5]]


def _deterministic_knowledge_answer(articles: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for article in articles[:3]:
        title = str(article.get("title") or "Tài liệu đã duyệt")
        body = " ".join(str(article.get("body") or "").split())
        version = article.get("version") or 1
        parts.append(f"{title} (phiên bản {version}): {body[:700]}")
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Dispatcher nội bộ
# ---------------------------------------------------------------------------


async def _fetch_context(
    conn: asyncpg.Connection,
    parsed: _ParsedQuestion,
    xa_id: str | None,
    caller_role: str = "dan",
    caller_village_id: str | None = None,
    caller_user_id: str | None = None,
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
            caller_user_id=caller_user_id,
        )

    if intent in (_QueryIntent.VILLAGE_ALL_STATS, _QueryIntent.COMPARE_VILLAGES):
        return await _query_village_all_stats(
            conn,
            village_names=parsed.village_names,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
            caller_user_id=caller_user_id,
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
            caller_user_id=caller_user_id,
        )

    if intent == _QueryIntent.PERIOD_SUMMARY:
        return await _query_period_summary(
            conn,
            ct_code=parsed.ct_code,
            period_name=parsed.period_name,
            xa_id=xa_id,
            caller_role=caller_role,
            caller_village_id=caller_village_id,
            caller_user_id=caller_user_id,
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
            caller_user_id=caller_user_id,
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
    caller_user_id: str | None = None,
    history: list[dict[str, str]] | None = None,
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

    if _mentions_pending_village_mapping(question):
        return ChatbotAnswer(
            question=question,
            answer=_pending_village_mapping_answer(),
            intent="PENDING_VILLAGE_MAPPING",
            rows_retrieved=0,
        )

    # Fast deterministic rules handle common questions. Gemini is only a
    # constrained NLU fallback for natural paraphrases and conversational
    # follow-ups. Its structured result is validated against backend
    # allowlists before any permission check or database query happens.
    needs_nlu_fallback = parsed.intent == _QueryIntent.UNKNOWN or bool(
        history
        and parsed.intent == _QueryIntent.VILLAGE_INDICATOR
        and not parsed.village_names
    )
    if needs_nlu_fallback:
        model_parsed = await _classify_question_with_gemini(question, history)
        if model_parsed is not None:
            parsed = model_parsed

    if parsed.intent == _QueryIntent.OUT_OF_SCOPE:
        return ChatbotAnswer(
            question=question,
            answer=_out_of_scope_answer(),
            intent=parsed.intent.name,
            rows_retrieved=0,
        )

    if parsed.intent in {_QueryIntent.HELP, _QueryIntent.UNKNOWN}:
        # For free-form questions, search only approved articles visible to
        # this role before falling back to generic guidance.
        article_conn: asyncpg.Connection | None = None
        try:
            if db_pool is not None:
                article_conn = await db_pool.acquire()
            else:
                settings = load_settings()
                if settings.database_url:
                    article_conn = await asyncpg.connect(dsn=settings.database_url, statement_cache_size=0)
            if article_conn is not None:
                articles = await _fetch_knowledge_articles(article_conn, question, xa_id, caller_role)
                if articles:
                    prompt = _build_gemini_prompt(question, [], knowledge_articles=articles)
                    try:
                        answer_text = await get_gemini_client().generate_text(
                            GEMINI_SYSTEM_PROMPT, prompt, max_output_tokens=_MAX_OUTPUT_TOKENS, temperature=_GEMINI_TEMPERATURE
                        )
                    except GeminiError:
                        answer_text = _deterministic_knowledge_answer(articles)
                    return ChatbotAnswer(question=question, answer=answer_text.strip(), intent="KNOWLEDGE_ARTICLE", rows_retrieved=len(articles))
        except asyncpg.PostgresError as exc:
            raise ChatbotError("Không thể truy vấn tài liệu nghiệp vụ.") from exc
        finally:
            if article_conn is not None:
                if db_pool is not None:
                    await db_pool.release(article_conn)
                else:
                    await article_conn.close()
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
            caller_user_id,
        )
    except asyncpg.PostgresError as exc:
        raise ChatbotError("Không thể truy vấn cơ sở dữ liệu.") from exc
    finally:
        if conn is not None:
            if db_pool is not None:
                await db_pool.release(conn)
            else:
                await conn.close()

    # Never ask the answer model to fill a missing value. A deterministic
    # response makes the absence or permission boundary explicit.
    if not context_rows:
        return ChatbotAnswer(
            question=question,
            answer=_no_data_answer(parsed, caller_role),
            intent=parsed.intent.name,
            rows_retrieved=0,
        )

    prompt = _build_gemini_prompt(question, context_rows, parsed.village_names)

    try:
        answer_text = await get_gemini_client().generate_text(
            GEMINI_SYSTEM_PROMPT,
            prompt,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            temperature=_GEMINI_TEMPERATURE,
        )
    except GeminiError:
        # A missing/over-quota model must not make deterministic public data
        # unavailable. The fallback deliberately emits only rows already
        # filtered by role/publication scope and never invents a value.
        answer_text = _deterministic_data_answer(context_rows)

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
