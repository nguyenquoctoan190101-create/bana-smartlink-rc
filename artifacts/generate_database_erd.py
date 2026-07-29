from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


WIDTH = 7016
HEIGHT = 4961
DPI = 600

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "Ba_Na_SmartLink_Database_ERD_A4_600dpi.png"

FONT_DIR = Path(r"C:\Windows\Fonts")
FONT_REGULAR = FONT_DIR / "segoeui.ttf"
FONT_SEMIBOLD = FONT_DIR / "seguisb.ttf"
FONT_BOLD = FONT_DIR / "segoeuib.ttf"

BG = "#F4F7FB"
INK = "#172033"
MUTED = "#5C667A"
LINE = "#D9E0EB"
CARD = "#FFFFFF"
WHITE = "#FFFFFF"


@dataclass(frozen=True)
class TableCard:
    name: str
    pk: str
    fk: str
    core: str


@dataclass(frozen=True)
class Domain:
    title: str
    subtitle: str
    accent: str
    light: str
    tables: tuple[TableCard, ...]
    cols: int
    rows: int


FOUNDATION = Domain(
    "01 · NỀN TẢNG, ĐỊA BÀN & ĐỊNH DANH",
    "auth.users → user_profiles ↔ villages · bản đồ sáp nhập và dữ liệu cách ly",
    "#0B6B83",
    "#E5F4F7",
    (
        TableCard("villages", "id uuid", "—", "commune_id · name · household_count jsonb · is_active"),
        TableCard("user_profiles", "id uuid → auth.users.id", "village_id → villages", "commune_id · display_name · role · is_active"),
        TableCard("user_village_assignments", "user_id + village_id", "user_id/assigned_by → user_profiles · village_id → villages", "created_at"),
        TableCard("village_merge_map", "old_village_name text", "new/proposed_new_village_id → villages", "mapping_status · mapping_version · source_note"),
        TableCard("villages_legacy", "id uuid", "dissolved/proposed_* → villages", "old_name · legacy_unit_type · mapping_status"),
        TableCard("schema_migrations", "name text", "—", "sha256 · applied_at"),
        TableCard("migration_quarantine", "id uuid", "—", "entity_type · source_id · payload jsonb · reason"),
    ),
    2,
    4,
)

REPORTING = Domain(
    "02 · BÁO CÁO, KIỂM DUYỆT & THÔNG BÁO",
    "report_periods + villages → reports → values / flags / updates / receipts / evidence",
    "#1D4ED8",
    "#EAF0FF",
    (
        TableCard("report_periods", "id uuid", "created_by → user_profiles · archived_by_request_id → change_requests", "commune_id · name · due_date · template_* · archived_at"),
        TableCard("report_period_villages", "period_id + village_id", "period_id → report_periods · village_id → villages", "created_at"),
        TableCard("reports", "id uuid", "village_id → villages · period_id → report_periods · *_by → user_profiles", "workflow/timeliness/publication_status · source · version"),
        TableCard("report_values", "id uuid", "report_id → reports", "ct_code CT01–CT14 · value · note"),
        TableCard("report_validation_flags", "id uuid", "report_id → reports · resolved_by → user_profiles", "ct_code · error_type · message · resolved"),
        TableCard("pending_updates", "id uuid", "report_id → reports · proposed/reviewed_by → user_profiles", "ct_code · proposed_value · consent_* · tracking_code · status"),
        TableCard("report_submission_receipts", "idempotency_key uuid", "report_id → reports · user_id → user_profiles", "version · workflow_status · submitted_at"),
        TableCard("report_extraction_evidence", "id uuid", "logical: user_id · consumed_report_id", "source_type · checksums · extractor_versions · expires/consumed_at"),
        TableCard("audit_log", "id uuid", "user_id → user_profiles", "commune_id · action · table_name · record_id · details jsonb"),
        TableCard("evacuation_points", "id uuid", "village_id → villages", "name · lat/long · capacity_households · contact · verified"),
        TableCard("push_subscriptions", "id uuid", "user_id → user_profiles", "endpoint · keys_p256dh · keys_auth · device_label"),
        TableCard("notifications", "id uuid", "user_id → user_profiles", "title · body · url · is_read · read_at"),
        TableCard("reminder_log", "id uuid", "period_id → report_periods · village_id → villages · recipient → user_profiles", "milestone · delivery_status · sent_at"),
        TableCard("report_period_change_requests", "id uuid", "period_id → report_periods · requested_by → user_profiles", "request_kind · reason · before/proposed_snapshot"),
        TableCard("report_period_change_decisions", "id uuid", "request_id → change_requests · decided_by → user_profiles", "decision · reason · decided_at"),
    ),
    3,
    5,
)

OPERATIONS = Domain(
    "03 · ĐIỀU HÀNH & ĐỔI MỚI",
    "dữ liệu quyết định, hành động, trưởng thành số và từ điển nhập liệu",
    "#7C3AED",
    "#F1EAFE",
    (
        TableCard("action_items", "id uuid", "period_id → report_periods · village_id → villages · owner/creator → users", "source_type · title · priority · status · due_date · outcome"),
        TableCard("digital_maturity_assessments", "id uuid", "created/approved_by → user_profiles", "commune_id · quarter_start · scores/evidence jsonb · status"),
        TableCard("innovation_initiatives", "id uuid", "owner/created_by → user_profiles", "problem · value_hypothesis · effort · risk · KPI jsonb · decision"),
        TableCard("ai_action_drafts", "id uuid", "period/village → report domain · created/reviewed_by → users", "kind · content · citations · confidence · status"),
        TableCard("field_synonyms", "id uuid", "created_by → user_profiles", "commune_id · normalized/original_name · ct_code"),
    ),
    1,
    5,
)

IMPORTS = Domain(
    "04 · NHẬP DỮ LIỆU & LINEAGE",
    "batch → files → resolutions · reports ↔ source files",
    "#B45309",
    "#FFF3DD",
    (
        TableCard("report_import_batches", "id uuid", "period_id → report_periods · created/committed_by → users", "commune_id · status · mapping_version · expected_count"),
        TableCard("report_import_files", "id uuid", "batch_id → batches · legacy/target_village → villages · reviewed_by → users", "filename · sha256 · raw/normalized_values · review_status"),
        TableCard("report_import_resolutions", "id uuid", "import_file_id → report_import_files · resolved_by → users", "ct_code · raw/accepted_value · decision · reason"),
        TableCard("report_import_lineage", "report_id + import_file_id", "report_id → reports · import_file_id → report_import_files", "created_at"),
    ),
    1,
    4,
)

CITIZEN = Domain(
    "05 · KIẾN NGHỊ HIỆN TRƯỜNG",
    "routing_rules → citizen_cases → location / media / history / assignments",
    "#BE123C",
    "#FDEBF0",
    (
        TableCard("routing_rules", "id uuid", "created_by → user_profiles", "commune_id · category · department · priority · is_active"),
        TableCard("citizen_cases", "id uuid", "village_id → villages · routing_rule_id → routing_rules", "category · description · priority · status · SLA · consent · tracking_hash"),
        TableCard("case_locations", "case_id uuid", "case_id → citizen_cases", "latitude · longitude · accuracy_m · source · confirmed"),
        TableCard("case_media", "id uuid", "case_id → citizen_cases", "storage_path · sha256 · mime_type · size · moderation_status"),
        TableCard("case_status_history", "id uuid", "case_id → citizen_cases · changed_by → user_profiles", "old_status · new_status · note · created_at"),
        TableCard("case_assignments", "id uuid", "case_id → citizen_cases · assignee/assigned_by → user_profiles", "department · created_at"),
    ),
    2,
    3,
)

KNOWLEDGE = Domain(
    "06 · TRI THỨC & KỊCH BẢN",
    "champions → support points · articles → revisions · scenarios → assumptions / runs",
    "#047857",
    "#E5F7F0",
    (
        TableCard("digital_champions", "id uuid", "user/created_by → user_profiles · village_id → villages", "commune_id · skills jsonb · schedule · groups · active"),
        TableCard("community_support_points", "id uuid", "village_id → villages · champion_id → champions · created_by → users", "name · address · opening_hours · equipment"),
        TableCard("knowledge_articles", "id uuid", "created/approved_by → user_profiles", "title · body · category · audience · version · status"),
        TableCard("knowledge_revisions", "id uuid", "article_id → knowledge_articles · changed_by → users", "version · title · body · created_at"),
        TableCard("scenarios", "id uuid", "created/approved_by → user_profiles", "commune_id · name · description · status"),
        TableCard("scenario_assumptions", "id uuid", "scenario_id → scenarios", "key · value · unit · source_note"),
        TableCard("scenario_runs", "id uuid", "scenario_id → scenarios · created_by → users", "baseline/assumptions/result jsonb · formula_version"),
    ),
    2,
    4,
)

IOT_TOURISM = Domain(
    "07 · IOT, CẢNH BÁO & DU LỊCH",
    "devices → observations / health / alerts → deliveries · places → localized content",
    "#C2410C",
    "#FFF0E8",
    (
        TableCard("sensor_devices", "id uuid", "created_by → user_profiles", "commune_id · type · unit · lat/long · calibration · last_seen"),
        TableCard("sensor_observations", "id uuid", "device_id → sensor_devices", "observed/received_at · value · unit · quality_flag"),
        TableCard("sensor_health", "device_id uuid", "device_id → sensor_devices", "battery_pct · signal_strength · last_error · checked_at"),
        TableCard("alert_rules", "id uuid", "created_by → user_profiles", "device_type · threshold · comparator · hysteresis · severity"),
        TableCard("alerts", "id uuid", "rule_id → alert_rules · device_id → sensor_devices", "severity · headline · source · status · effective_*"),
        TableCard("alert_deliveries", "id uuid", "alert_id → alerts", "channel · recipient_scope · delivery_status · receipt"),
        TableCard("tourism_places", "id uuid", "created/approved_by → user_profiles", "name · category · summary · lat/long · status"),
        TableCard("tourism_content", "id uuid", "place_id → tourism_places · created/approved_by → users", "locale · title · body · media_url · license · status"),
    ),
    2,
    4,
)


DOMAINS = (
    FOUNDATION,
    REPORTING,
    OPERATIONS,
    IMPORTS,
    CITIZEN,
    KNOWLEDGE,
    IOT_TOURISM,
)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


TITLE_FONT = font(FONT_BOLD, 104)
SUBTITLE_FONT = font(FONT_REGULAR, 42)
BADGE_FONT = font(FONT_SEMIBOLD, 34)
PANEL_FONT = font(FONT_BOLD, 48)
PANEL_SUB_FONT = font(FONT_REGULAR, 29)
CARD_TITLE_FONT = font(FONT_SEMIBOLD, 40)
CARD_DETAIL_FONT = font(FONT_REGULAR, 27)
CARD_LABEL_FONT = font(FONT_SEMIBOLD, 27)
FOOTER_FONT = font(FONT_REGULAR, 26)


def text_width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont) -> float:
    box = draw.textbbox((0, 0), text, font=face)
    return box[2] - box[0]


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    face: ImageFont.FreeTypeFont,
    max_width: int,
    max_lines: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if text_width(draw, candidate, face) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    consumed = " ".join(lines)
    if len(consumed) < len(text) and lines:
        last = lines[-1]
        while last and text_width(draw, f"{last}…", face) > max_width:
            last = last[:-1]
        lines[-1] = f"{last.rstrip()}…"
    return lines


def draw_badge(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    fill: str,
    ink: str,
) -> int:
    pad_x = 24
    width = int(text_width(draw, text, BADGE_FONT)) + pad_x * 2
    draw.rounded_rectangle((x, y, x + width, y + 62), radius=31, fill=fill)
    draw.text((x + pad_x, y + 10), text, font=BADGE_FONT, fill=ink)
    return width


def draw_detail(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    label: str,
    value: str,
    max_width: int,
    accent: str,
    max_lines: int = 2,
) -> int:
    label_width = int(text_width(draw, label, CARD_LABEL_FONT))
    draw.text((x, y), label, font=CARD_LABEL_FONT, fill=accent)
    value_x = x + label_width + 10
    available = max_width - label_width - 10
    lines = wrap_text(draw, value, CARD_DETAIL_FONT, available, max_lines)
    line_height = 34
    for idx, line in enumerate(lines):
        draw.text((value_x if idx == 0 else x, y + idx * line_height), line, font=CARD_DETAIL_FONT, fill=INK)
    return max(1, len(lines)) * line_height


def draw_card(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    card: TableCard,
    accent: str,
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=24, fill=CARD, outline=LINE, width=3)
    draw.rounded_rectangle((x0, y0, x0 + 13, y1), radius=7, fill=accent)
    inner_x = x0 + 34
    inner_w = x1 - inner_x - 22
    title_y = y0 + 20
    draw.text((inner_x, title_y), card.name, font=CARD_TITLE_FONT, fill=INK)
    divider_y = title_y + 57
    draw.line((inner_x, divider_y, x1 - 20, divider_y), fill=LINE, width=2)
    cursor = divider_y + 13
    cursor += draw_detail(draw, inner_x, cursor, "PK", card.pk, inner_w, accent, 1) + 2
    cursor += draw_detail(draw, inner_x, cursor, "FK", card.fk, inner_w, accent, 2) + 2
    remaining = max(1, int((y1 - cursor - 15) / 34))
    draw_detail(draw, inner_x, cursor, "CORE", card.core, inner_w, accent, min(2, remaining))


def draw_panel(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    domain: Domain,
) -> None:
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=34, fill=domain.light, outline=domain.accent, width=4)
    draw.rounded_rectangle((x0, y0, x1, y0 + 105), radius=34, fill=domain.accent)
    draw.rectangle((x0, y0 + 65, x1, y0 + 105), fill=domain.accent)
    draw.text((x0 + 28, y0 + 24), domain.title, font=PANEL_FONT, fill=WHITE)
    draw.text((x0 + 29, y0 + 118), domain.subtitle, font=PANEL_SUB_FONT, fill=MUTED)

    left = x0 + 25
    right = x1 - 25
    top = y0 + 176
    bottom = y1 - 25
    col_gap = 24
    row_gap = 22
    card_w = int((right - left - (domain.cols - 1) * col_gap) / domain.cols)
    card_h = int((bottom - top - (domain.rows - 1) * row_gap) / domain.rows)

    for idx, card in enumerate(domain.tables):
        row = idx // domain.cols
        col = idx % domain.cols
        card_x0 = left + col * (card_w + col_gap)
        card_y0 = top + row * (card_h + row_gap)
        draw_card(
            draw,
            (card_x0, card_y0, card_x0 + card_w, card_y0 + card_h),
            card,
            domain.accent,
        )


def all_table_names(domains: Iterable[Domain]) -> list[str]:
    return [table.name for domain in domains for table in domain.tables]


def main() -> None:
    names = all_table_names(DOMAINS)
    if len(names) != 52:
        raise RuntimeError(f"Expected 52 public tables, found {len(names)}")
    if len(names) != len(set(names)):
        raise RuntimeError("Duplicate table names detected")

    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    draw.text((120, 72), "CẤU TRÚC DATABASE · BÀ NÀ SMARTLINK", font=TITLE_FONT, fill=INK)
    draw.text(
        (125, 202),
        "PostgreSQL / Supabase · Sơ đồ ERD logic toàn hệ thống · A4 ngang 600 DPI",
        font=SUBTITLE_FONT,
        fill=MUTED,
    )
    badge_x = 4930
    badge_x += draw_badge(draw, badge_x, 92, "52 BẢNG PUBLIC", "#DDE8FF", "#1D4ED8") + 20
    badge_x += draw_badge(draw, badge_x, 92, "AUTH.USERS NGOÀI MIỀN", "#E5F7F0", "#047857") + 20
    draw_badge(draw, badge_x, 92, "RLS / AUDIT", "#F1EAFE", "#7C3AED")

    top_y = 330
    top_h = 2050
    draw_panel(draw, (120, top_y, 1800, top_y + top_h), FOUNDATION)
    draw_panel(draw, (1845, top_y, 5605, top_y + top_h), REPORTING)
    draw_panel(draw, (5650, top_y, 6896, top_y + top_h), OPERATIONS)

    bottom_y = 2425
    bottom_h = 2260
    draw_panel(draw, (120, bottom_y, 1440, bottom_y + bottom_h), IMPORTS)
    draw_panel(draw, (1485, bottom_y, 2955, bottom_y + bottom_h), CITIZEN)
    draw_panel(draw, (3000, bottom_y, 4760, bottom_y + bottom_h), KNOWLEDGE)
    draw_panel(draw, (4805, bottom_y, 6896, bottom_y + bottom_h), IOT_TOURISM)

    footer_y = 4730
    draw.line((120, footer_y, 6896, footer_y), fill=LINE, width=3)
    draw.text(
        (120, footer_y + 24),
        "Ký hiệu: PK = khóa chính · FK = khóa ngoại · → = tham chiếu tới. "
        "Các quan hệ user/commune lặp lại được ghi trong từng thẻ để tránh giao tuyến.",
        font=FOOTER_FONT,
        fill=MUTED,
    )
    draw.text(
        (120, footer_y + 64),
        "Nguồn: db/schema.sql + migrations 0001–0031 · Commit triển khai: 6a3f0550 · 29/07/2026",
        font=FOOTER_FONT,
        fill=MUTED,
    )
    draw.text(
        (5720, footer_y + 64),
        f"{WIDTH} × {HEIGHT} px · {DPI} DPI",
        font=FOOTER_FONT,
        fill=INK,
    )

    image.save(OUTPUT, format="PNG", dpi=(DPI, DPI), optimize=True)
    print(OUTPUT)
    print(f"{image.width}x{image.height} @ {DPI} DPI")


if __name__ == "__main__":
    main()
