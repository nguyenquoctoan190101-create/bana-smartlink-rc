from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from math import atan2, cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


# A4 portrait at 600 DPI.
WIDTH = 4961
HEIGHT = 7016
DPI = 600

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "Ba_Na_SmartLink_Database_ERD_A4_600dpi.png"

FONT_DIR = Path(r"C:\Windows\Fonts")
FONT_REGULAR = FONT_DIR / "segoeui.ttf"
FONT_SEMIBOLD = FONT_DIR / "seguisb.ttf"
FONT_BOLD = FONT_DIR / "segoeuib.ttf"

BACKGROUND = "#34363B"
BACKGROUND_GRID = "#42454B"
NODE_FILL = "#111318"
NODE_BORDER = "#08090C"
NODE_TEXT = "#F5F7FA"
NODE_MUTED = "#9EA4AE"
EDGE = "#0C0D10"
EDGE_HIGHLIGHT = "#DCE7FF"
HIGHLIGHT_FILL = "#FFFFFF"
HIGHLIGHT_TEXT = "#111318"
EXTERNAL_FILL = "#24272D"


@dataclass(frozen=True)
class TableNode:
    name: str
    domain: str
    x: int
    y: int
    pk: str = "id"
    width: int = 520
    height: int = 158
    external: bool = False
    highlighted: bool = False


DOMAIN_COLORS = {
    "external": "#B7BDC7",
    "foundation": "#21C3D6",
    "reporting": "#4E8CFF",
    "operations": "#A26BFA",
    "imports": "#F4A640",
    "citizen": "#F0527E",
    "knowledge": "#28C38D",
    "iot": "#F06A35",
}


NODES = (
    TableNode("auth.users", "external", 2205, 190, "id", 550, 150, external=True),
    TableNode("schema_migrations", "foundation", 160, 540, "name"),
    TableNode("migration_quarantine", "foundation", 830, 540),
    TableNode("villages", "foundation", 1500, 540),
    TableNode("user_profiles", "foundation", 2170, 540, "id → auth.users"),
    TableNode(
        "user_village_assignments",
        "foundation",
        2840,
        540,
        "user_id + village_id",
    ),
    TableNode("village_merge_map", "foundation", 3510, 540, "old_village_name"),
    TableNode("villages_legacy", "foundation", 4180, 540),
    TableNode("report_periods", "reporting", 1280, 1240),
    TableNode(
        "report_period_villages",
        "reporting",
        1950,
        1240,
        "period_id + village_id",
    ),
    TableNode("report_period_change_requests", "reporting", 2620, 1240),
    TableNode("report_period_change_decisions", "reporting", 3290, 1240),
    TableNode("evacuation_points", "reporting", 160, 1690),
    TableNode("reminder_log", "reporting", 830, 1690),
    TableNode(
        "reports",
        "reporting",
        2105,
        1890,
        "id",
        750,
        220,
        highlighted=True,
    ),
    TableNode("push_subscriptions", "reporting", 3510, 1690),
    TableNode("notifications", "reporting", 4180, 1690),
    TableNode("report_values", "reporting", 160, 2310),
    TableNode("report_validation_flags", "reporting", 830, 2310),
    TableNode("pending_updates", "reporting", 1500, 2310),
    TableNode("report_submission_receipts", "reporting", 2840, 2310, "idempotency_key"),
    TableNode("report_extraction_evidence", "reporting", 3510, 2310),
    TableNode("audit_log", "reporting", 4180, 2310),
    TableNode("ai_action_drafts", "operations", 1500, 2920),
    TableNode("action_items", "operations", 2170, 2920),
    TableNode("digital_maturity_assessments", "operations", 2840, 2920),
    TableNode("innovation_initiatives", "operations", 3510, 2920),
    TableNode("field_synonyms", "operations", 4180, 2920),
    TableNode("report_import_batches", "imports", 160, 3210),
    TableNode("report_import_files", "imports", 160, 3670),
    TableNode(
        "report_import_lineage",
        "imports",
        830,
        3670,
        "report_id + import_file_id",
    ),
    TableNode("report_import_resolutions", "imports", 160, 4130),
    TableNode("digital_champions", "knowledge", 1500, 3970),
    TableNode("knowledge_articles", "knowledge", 2170, 3970),
    TableNode("scenarios", "knowledge", 2840, 3970),
    TableNode("sensor_devices", "iot", 3510, 3670),
    TableNode("alert_rules", "iot", 4180, 3670),
    TableNode("community_support_points", "knowledge", 1500, 4430),
    TableNode("knowledge_revisions", "knowledge", 2170, 4430),
    TableNode("scenario_assumptions", "knowledge", 2840, 4430),
    TableNode("sensor_observations", "iot", 3510, 4130),
    TableNode("sensor_health", "iot", 4180, 4130, "device_id"),
    TableNode("routing_rules", "citizen", 830, 4560),
    TableNode("citizen_cases", "citizen", 830, 5020),
    TableNode("case_assignments", "citizen", 1500, 5020),
    TableNode("scenario_runs", "knowledge", 2840, 5020),
    TableNode("alerts", "iot", 3850, 4720),
    TableNode("case_locations", "citizen", 160, 5540, "case_id"),
    TableNode("case_media", "citizen", 830, 5540),
    TableNode("case_status_history", "citizen", 1500, 5540),
    TableNode("alert_deliveries", "iot", 3850, 5200),
    TableNode("tourism_places", "iot", 3510, 5790),
    TableNode("tourism_content", "iot", 4180, 5790),
)


# (parent table, child table, logical-only relationship)
EDGES = (
    ("auth.users", "user_profiles", False),
    ("villages", "user_profiles", False),
    ("user_profiles", "user_village_assignments", False),
    ("villages", "user_village_assignments", False),
    ("villages", "village_merge_map", False),
    ("villages", "villages_legacy", False),
    ("user_profiles", "report_periods", False),
    ("report_periods", "report_period_villages", False),
    ("villages", "report_period_villages", False),
    ("villages", "reports", False),
    ("report_periods", "reports", False),
    ("user_profiles", "reports", False),
    ("reports", "report_values", False),
    ("reports", "report_validation_flags", False),
    ("user_profiles", "report_validation_flags", False),
    ("reports", "pending_updates", False),
    ("user_profiles", "pending_updates", False),
    ("reports", "report_submission_receipts", False),
    ("user_profiles", "report_submission_receipts", False),
    ("reports", "report_extraction_evidence", True),
    ("user_profiles", "report_extraction_evidence", True),
    ("user_profiles", "audit_log", False),
    ("villages", "evacuation_points", False),
    ("user_profiles", "push_subscriptions", False),
    ("user_profiles", "notifications", False),
    ("report_periods", "reminder_log", False),
    ("villages", "reminder_log", False),
    ("user_profiles", "reminder_log", False),
    ("report_periods", "report_period_change_requests", False),
    ("user_profiles", "report_period_change_requests", False),
    ("report_period_change_requests", "report_period_change_decisions", False),
    ("user_profiles", "report_period_change_decisions", False),
    ("report_period_change_requests", "report_periods", False),
    ("report_periods", "action_items", False),
    ("villages", "action_items", False),
    ("user_profiles", "action_items", False),
    ("user_profiles", "digital_maturity_assessments", False),
    ("user_profiles", "innovation_initiatives", False),
    ("report_periods", "ai_action_drafts", False),
    ("villages", "ai_action_drafts", False),
    ("user_profiles", "ai_action_drafts", False),
    ("user_profiles", "field_synonyms", False),
    ("report_periods", "report_import_batches", False),
    ("user_profiles", "report_import_batches", False),
    ("report_import_batches", "report_import_files", False),
    ("villages_legacy", "report_import_files", False),
    ("villages", "report_import_files", False),
    ("user_profiles", "report_import_files", False),
    ("report_import_files", "report_import_resolutions", False),
    ("user_profiles", "report_import_resolutions", False),
    ("reports", "report_import_lineage", False),
    ("report_import_files", "report_import_lineage", False),
    ("user_profiles", "routing_rules", False),
    ("villages", "citizen_cases", False),
    ("routing_rules", "citizen_cases", False),
    ("citizen_cases", "case_locations", False),
    ("citizen_cases", "case_media", False),
    ("citizen_cases", "case_status_history", False),
    ("user_profiles", "case_status_history", False),
    ("citizen_cases", "case_assignments", False),
    ("user_profiles", "case_assignments", False),
    ("user_profiles", "digital_champions", False),
    ("villages", "digital_champions", False),
    ("villages", "community_support_points", False),
    ("digital_champions", "community_support_points", False),
    ("user_profiles", "community_support_points", False),
    ("user_profiles", "knowledge_articles", False),
    ("knowledge_articles", "knowledge_revisions", False),
    ("user_profiles", "knowledge_revisions", False),
    ("user_profiles", "scenarios", False),
    ("scenarios", "scenario_assumptions", False),
    ("scenarios", "scenario_runs", False),
    ("user_profiles", "scenario_runs", False),
    ("user_profiles", "sensor_devices", False),
    ("sensor_devices", "sensor_observations", False),
    ("sensor_devices", "sensor_health", False),
    ("user_profiles", "alert_rules", False),
    ("alert_rules", "alerts", False),
    ("sensor_devices", "alerts", False),
    ("alerts", "alert_deliveries", False),
    ("user_profiles", "tourism_places", False),
    ("tourism_places", "tourism_content", False),
    ("user_profiles", "tourism_content", False),
)


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


TITLE_FONT = font(FONT_BOLD, 88)
SUBTITLE_FONT = font(FONT_REGULAR, 34)
DOMAIN_FONT = font(FONT_SEMIBOLD, 28)
NODE_TITLE_FONT = font(FONT_SEMIBOLD, 31)
NODE_META_FONT = font(FONT_REGULAR, 22)
HIGHLIGHT_TITLE_FONT = font(FONT_BOLD, 43)
HIGHLIGHT_META_FONT = font(FONT_REGULAR, 27)
FOOTER_FONT = font(FONT_REGULAR, 24)


def center(node: TableNode) -> tuple[float, float]:
    return node.x + node.width / 2, node.y + node.height / 2


def boundary_point(
    node: TableNode,
    toward: tuple[float, float],
) -> tuple[float, float]:
    cx, cy = center(node)
    dx = toward[0] - cx
    dy = toward[1] - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (node.width / 2) / abs(dx) if dx else float("inf")
    sy = (node.height / 2) / abs(dy) if dy else float("inf")
    scale = min(sx, sy)
    return cx + dx * scale, cy + dy * scale


def curve_points(
    start: tuple[float, float],
    end: tuple[float, float],
    edge_key: str,
) -> list[tuple[float, float]]:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    distance = max(1.0, (dx * dx + dy * dy) ** 0.5)
    nx = -dy / distance
    ny = dx / distance
    digest = sha256(edge_key.encode("utf-8")).digest()
    signed = (digest[0] / 255.0) * 2.0 - 1.0
    bend = signed * min(210.0, distance * 0.13)
    control1 = (
        start[0] + dx * 0.36 + nx * bend,
        start[1] + dy * 0.36 + ny * bend,
    )
    control2 = (
        start[0] + dx * 0.68 + nx * bend,
        start[1] + dy * 0.68 + ny * bend,
    )
    points: list[tuple[float, float]] = []
    for index in range(41):
        t = index / 40
        mt = 1 - t
        x = (
            mt**3 * start[0]
            + 3 * mt**2 * t * control1[0]
            + 3 * mt * t**2 * control2[0]
            + t**3 * end[0]
        )
        y = (
            mt**3 * start[1]
            + 3 * mt**2 * t * control1[1]
            + 3 * mt * t**2 * control2[1]
            + t**3 * end[1]
        )
        points.append((x, y))
    return points


def draw_dashed_curve(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    fill: tuple[int, int, int, int],
    width: int,
) -> None:
    for index in range(len(points) - 1):
        if (index // 2) % 2 == 0:
            draw.line((points[index], points[index + 1]), fill=fill, width=width)


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    previous: tuple[float, float],
    tip: tuple[float, float],
    fill: tuple[int, int, int, int],
    size: int,
) -> None:
    angle = atan2(tip[1] - previous[1], tip[0] - previous[0])
    left = (
        tip[0] - size * cos(angle - pi / 6),
        tip[1] - size * sin(angle - pi / 6),
    )
    right = (
        tip[0] - size * cos(angle + pi / 6),
        tip[1] - size * sin(angle + pi / 6),
    )
    draw.polygon((tip, left, right), fill=fill)


def draw_background(draw: ImageDraw.ImageDraw) -> None:
    grid = 110
    for x in range(0, WIDTH, grid):
        draw.line((x, 0, x, HEIGHT), fill=BACKGROUND_GRID, width=1)
    for y in range(0, HEIGHT, grid):
        draw.line((0, y, WIDTH, y), fill=BACKGROUND_GRID, width=1)
    for x in range(0, WIDTH, grid * 5):
        draw.line((x, 0, x, HEIGHT), fill="#4A4D54", width=2)
    for y in range(0, HEIGHT, grid * 5):
        draw.line((0, y, WIDTH, y), fill="#4A4D54", width=2)


def draw_domain_label(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    domain: str,
) -> None:
    color = DOMAIN_COLORS[domain]
    draw.rounded_rectangle((x, y, x + 42, y + 42), radius=9, fill=color)
    draw.text((x + 58, y + 4), text, font=DOMAIN_FONT, fill=NODE_MUTED)


def draw_node(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    node: TableNode,
    relation_count: int,
) -> None:
    box = (node.x, node.y, node.x + node.width, node.y + node.height)
    color = DOMAIN_COLORS[node.domain]

    if node.highlighted:
        glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        glow_draw.rounded_rectangle(
            (node.x - 28, node.y - 28, node.x + node.width + 28, node.y + node.height + 28),
            radius=38,
            fill=(216, 231, 255, 115),
        )
        glow = glow.filter(ImageFilter.GaussianBlur(28))
        image.alpha_composite(glow)
        draw.rounded_rectangle(box, radius=24, fill=HIGHLIGHT_FILL, outline="#E2E8F0", width=5)
        draw.rectangle((node.x, node.y, node.x + 18, node.y + node.height), fill=color)
        draw.text(
            (node.x + 42, node.y + 27),
            node.name,
            font=HIGHLIGHT_TITLE_FONT,
            fill=HIGHLIGHT_TEXT,
        )
        draw.text(
            (node.x + 43, node.y + 97),
            f"PK  {node.pk}",
            font=HIGHLIGHT_META_FONT,
            fill="#3B414B",
        )
        draw.text(
            (node.x + 43, node.y + 145),
            f"{relation_count} quan hệ khóa ngoại / logic",
            font=HIGHLIGHT_META_FONT,
            fill="#555C68",
        )
        return

    fill = EXTERNAL_FILL if node.external else NODE_FILL
    draw.rounded_rectangle(box, radius=18, fill=fill, outline=NODE_BORDER, width=5)
    draw.rounded_rectangle(
        (node.x, node.y, node.x + node.width, node.y + 13),
        radius=7,
        fill=color,
    )
    draw.text(
        (node.x + 25, node.y + 31),
        node.name,
        font=NODE_TITLE_FONT,
        fill=NODE_TEXT,
    )
    draw.text(
        (node.x + 25, node.y + 91),
        f"PK  {node.pk}",
        font=NODE_META_FONT,
        fill=NODE_MUTED,
    )
    if not node.external:
        draw.text(
            (node.x + node.width - 25, node.y + 91),
            f"{relation_count} liên kết",
            font=NODE_META_FONT,
            fill=NODE_MUTED,
            anchor="ra",
        )


def main() -> None:
    public_nodes = [node for node in NODES if not node.external]
    if len(public_nodes) != 52:
        raise RuntimeError(f"Expected 52 public tables, found {len(public_nodes)}")
    by_name = {node.name: node for node in NODES}
    if len(by_name) != len(NODES):
        raise RuntimeError("Duplicate table names detected")
    for parent, child, _ in EDGES:
        if parent not in by_name or child not in by_name:
            raise RuntimeError(f"Unknown relationship: {parent} -> {child}")

    image = Image.new("RGBA", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw_background(draw)

    draw.text(
        (120, 72),
        "CẤU TRÚC QUAN HỆ DATABASE · BÀ NÀ SMARTLINK",
        font=TITLE_FONT,
        fill=NODE_TEXT,
    )
    draw.text(
        (125, 190),
        "PostgreSQL / Supabase · 52 bảng public + auth.users · ERD dạng đồ thị · A4 dọc 600 DPI",
        font=SUBTITLE_FONT,
        fill=NODE_MUTED,
    )

    draw_domain_label(draw, 160, 420, "NỀN TẢNG & ĐỊNH DANH", "foundation")
    draw_domain_label(draw, 160, 1110, "BÁO CÁO & KIỂM DUYỆT", "reporting")
    draw_domain_label(draw, 1500, 2780, "ĐIỀU HÀNH & ĐỔI MỚI", "operations")
    draw_domain_label(draw, 160, 3070, "NHẬP DỮ LIỆU & LINEAGE", "imports")
    draw_domain_label(draw, 830, 4420, "KIẾN NGHỊ HIỆN TRƯỜNG", "citizen")
    draw_domain_label(draw, 2170, 3830, "TRI THỨC & KỊCH BẢN", "knowledge")
    draw_domain_label(draw, 3510, 3530, "IOT, CẢNH BÁO & DU LỊCH", "iot")

    edge_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    edge_draw = ImageDraw.Draw(edge_layer)
    for parent_name, child_name, logical in EDGES:
        parent = by_name[parent_name]
        child = by_name[child_name]
        start = boundary_point(parent, center(child))
        end = boundary_point(child, center(parent))
        points = curve_points(start, end, f"{parent_name}>{child_name}")
        selected = parent.highlighted or child.highlighted
        fill = (220, 231, 255, 190) if selected else (8, 9, 12, 190)
        width = 8 if selected else 5
        if logical:
            draw_dashed_curve(edge_draw, points, fill, width)
        else:
            edge_draw.line(points, fill=fill, width=width, joint="curve")
        draw_arrow(
            edge_draw,
            points[-3],
            points[-1],
            fill,
            25 if selected else 18,
        )
    image.alpha_composite(edge_layer)

    relation_counts = {node.name: 0 for node in NODES}
    for parent, child, _ in EDGES:
        relation_counts[parent] += 1
        relation_counts[child] += 1
    for node in NODES:
        draw_node(image, draw, node, relation_counts[node.name])

    legend_y = 6590
    draw.rounded_rectangle(
        (120, legend_y, WIDTH - 120, legend_y + 245),
        radius=24,
        fill="#2B2D32",
        outline="#4B4E55",
        width=3,
    )
    draw.line((175, legend_y + 66, 345, legend_y + 66), fill=EDGE_HIGHLIGHT, width=8)
    draw_arrow(
        draw,
        (315, legend_y + 66),
        (345, legend_y + 66),
        (220, 231, 255, 255),
        24,
    )
    draw.text(
        (375, legend_y + 42),
        "Quan hệ nối với bảng đang chọn",
        font=FOOTER_FONT,
        fill=NODE_TEXT,
    )
    for x in range(1010, 1180, 34):
        draw.line((x, legend_y + 66, x + 18, legend_y + 66), fill="#B7BDC7", width=5)
    draw.text(
        (1210, legend_y + 42),
        "Quan hệ logic",
        font=FOOTER_FONT,
        fill=NODE_TEXT,
    )
    draw.rounded_rectangle(
        (1700, legend_y + 31, 1860, legend_y + 101),
        radius=12,
        fill=HIGHLIGHT_FILL,
    )
    draw.text(
        (1890, legend_y + 42),
        "Bảng trung tâm đang được nhấn mạnh",
        font=FOOTER_FONT,
        fill=NODE_TEXT,
    )
    draw.text(
        (175, legend_y + 135),
        "Mũi tên: bảng cha → bảng chứa khóa ngoại · RLS được bật trên toàn bộ 52 bảng public.",
        font=FOOTER_FONT,
        fill=NODE_MUTED,
    )
    draw.text(
        (175, legend_y + 181),
        "Nguồn: db/schema.sql + migrations 0001–0031 · Snapshot production 2822cbef · 29/07/2026",
        font=FOOTER_FONT,
        fill=NODE_MUTED,
    )
    draw.text(
        (WIDTH - 175, legend_y + 181),
        f"{WIDTH} × {HEIGHT} px · {DPI} DPI",
        font=FOOTER_FONT,
        fill=NODE_TEXT,
        anchor="ra",
    )

    image.convert("RGB").save(OUTPUT, format="PNG", dpi=(DPI, DPI), optimize=True)
    print(OUTPUT)
    print(f"{WIDTH}x{HEIGHT} @ {DPI} DPI")
    print(f"{len(public_nodes)} public tables, {len(EDGES)} relationships")


if __name__ == "__main__":
    main()
