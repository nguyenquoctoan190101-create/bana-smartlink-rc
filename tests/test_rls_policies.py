"""
tests/test_rls_policies.py
============================
Kiểm tra logic Row Level Security cho Ba Na SmartLink.

Phương pháp: Vì không có Supabase thật trong CI, chúng ta implement lại
chính xác logic của các hàm helper PostgreSQL (profile_role, profile_village_id,
can_select_village, can_modify_village, can_select_report, can_modify_report)
bằng Python thuần, rồi đánh giá từng policy USING/WITH CHECK cho mọi role.

Mỗi test kiểm tra một ô trong bảng ma trận quyền. Kết quả được in dưới dạng
bảng ASCII sau khi chạy pytest -s.

Chạy:
    pytest tests/test_rls_policies.py -v -s
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Literal

import pytest

# ---------------------------------------------------------------------------
# Kiểu dữ liệu giả lập
# ---------------------------------------------------------------------------

UserRole = Literal["admin_xa", "lanh_dao", "can_bo_thon", "to_cnscd", "dan", "anon"]

VILLAGE_A = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
VILLAGE_B = uuid.UUID("bbbbbbbb-0000-0000-0000-000000000002")
REPORT_A  = uuid.UUID("cccccccc-0000-0000-0000-000000000003")  # thuộc VILLAGE_A
REPORT_B  = uuid.UUID("dddddddd-0000-0000-0000-000000000004")  # thuộc VILLAGE_B


@dataclass
class UserProfile:
    id: uuid.UUID
    role: UserRole
    village_id: uuid.UUID | None = None
    force_password_reset: bool = False


@dataclass
class ReportRow:
    id: uuid.UUID
    village_id: uuid.UUID


# ---------------------------------------------------------------------------
# Fixture: người dùng mẫu cho mỗi role
# ---------------------------------------------------------------------------

PROFILES: dict[str, UserProfile] = {
    "admin_xa": UserProfile(
        id=uuid.UUID("11111111-0000-0000-0000-000000000001"),
        role="admin_xa",
        village_id=None,
    ),
    "lanh_dao": UserProfile(
        id=uuid.UUID("22222222-0000-0000-0000-000000000002"),
        role="lanh_dao",
        village_id=None,
    ),
    "can_bo_thon_A": UserProfile(
        id=uuid.UUID("33333333-0000-0000-0000-000000000003"),
        role="can_bo_thon",
        village_id=VILLAGE_A,
        force_password_reset=False,
    ),
    "can_bo_thon_A_locked": UserProfile(
        id=uuid.UUID("33333333-0000-0000-0000-000000000004"),
        role="can_bo_thon",
        village_id=VILLAGE_A,
        force_password_reset=True,  # chưa đổi mật khẩu → không ghi được
    ),
    "can_bo_thon_B": UserProfile(
        id=uuid.UUID("44444444-0000-0000-0000-000000000005"),
        role="can_bo_thon",
        village_id=VILLAGE_B,
        force_password_reset=False,
    ),
    "to_cnscd_A": UserProfile(
        id=uuid.UUID("55555555-0000-0000-0000-000000000006"),
        role="to_cnscd",
        village_id=VILLAGE_A,
        force_password_reset=False,
    ),
    "dan": UserProfile(
        id=uuid.UUID("66666666-0000-0000-0000-000000000007"),
        role="dan",
        village_id=VILLAGE_A,
    ),
    "anon": None,  # type: ignore[assignment] — không có profile
}

REPORTS: dict[uuid.UUID, ReportRow] = {
    REPORT_A: ReportRow(id=REPORT_A, village_id=VILLAGE_A),
    REPORT_B: ReportRow(id=REPORT_B, village_id=VILLAGE_B),
}


# ---------------------------------------------------------------------------
# Implement chính xác logic PostgreSQL helpers bằng Python
# ---------------------------------------------------------------------------

def profile_role(profile: UserProfile | None) -> UserRole | None:
    """Tương đương public.profile_role() trong Postgres."""
    return profile.role if profile else None


def profile_village_id(profile: UserProfile | None) -> uuid.UUID | None:
    """Tương đương public.profile_village_id() trong Postgres."""
    return profile.village_id if profile else None


def can_select_village(profile: UserProfile | None, target_village_id: uuid.UUID) -> bool:
    """Tương đương public.can_select_village(target_village_id)."""
    if profile is None:
        return False
    role = profile.role
    if role in ("admin_xa", "lanh_dao"):
        return True
    if role in ("can_bo_thon", "to_cnscd"):
        return profile.village_id == target_village_id
    return False


def can_modify_village(profile: UserProfile | None, target_village_id: uuid.UUID) -> bool:
    """Tương đương public.can_modify_village(target_village_id)."""
    if profile is None:
        return False
    return (
        profile.role in ("can_bo_thon", "to_cnscd")
        and profile.village_id == target_village_id
        and not profile.force_password_reset
    )


def can_select_report(
    profile: UserProfile | None,
    report_id: uuid.UUID,
) -> bool:
    """Tương đương public.can_select_report(report_id)."""
    report = REPORTS.get(report_id)
    if report is None:
        return False
    return can_select_village(profile, report.village_id)


def can_modify_report(
    profile: UserProfile | None,
    report_id: uuid.UUID,
) -> bool:
    """Tương đương public.can_modify_report(report_id)."""
    report = REPORTS.get(report_id)
    if report is None:
        return False
    return can_modify_village(profile, report.village_id)


# ---------------------------------------------------------------------------
# Đánh giá policy USING / WITH CHECK (tương đương Postgres evaluate)
# ---------------------------------------------------------------------------

class _PolicyEvaluator:
    """Đánh giá các policy RLS giống PostgreSQL."""

    def __init__(self, profile: UserProfile | None) -> None:
        self.p = profile

    # ---- villages & village_merge_map ----

    def villages_select(self) -> bool:
        # USING (true) → tất cả đều được SELECT
        return True  # áp dụng cho cả anon

    def villages_write(self) -> bool:
        # Không có policy → chặn tất cả authenticated; anon cũng chặn
        return False

    # ---- reports SELECT ----

    def reports_select(self, report: ReportRow) -> bool:
        role = profile_role(self.p)
        if role in ("admin_xa", "lanh_dao"):
            return True
        if role in ("can_bo_thon", "to_cnscd"):
            return report.village_id == profile_village_id(self.p)
        return False

    # ---- reports INSERT ----

    def reports_insert(self, village_id: uuid.UUID) -> bool:
        return can_modify_village(self.p, village_id)

    # ---- reports UPDATE ----

    def reports_update(self, report: ReportRow) -> bool:
        return can_modify_village(self.p, report.village_id) or profile_role(self.p) == "admin_xa"

    # ---- reports DELETE ----

    def reports_delete(self, _report: ReportRow) -> bool:
        return profile_role(self.p) == "admin_xa"

    # ---- report_values SELECT ----

    def report_values_select(self, report_id: uuid.UUID) -> bool:
        role = profile_role(self.p)
        if role in ("admin_xa", "lanh_dao"):
            return True
        return can_select_report(self.p, report_id)

    # ---- report_values INSERT ----

    def report_values_insert(self, report_id: uuid.UUID) -> bool:
        return can_modify_report(self.p, report_id)

    # ---- report_values UPDATE ----

    def report_values_update(self, report_id: uuid.UUID) -> bool:
        return can_modify_report(self.p, report_id) or profile_role(self.p) == "admin_xa"

    # ---- report_values DELETE ----

    def report_values_delete(self, _report_id: uuid.UUID) -> bool:
        return profile_role(self.p) == "admin_xa"

    # ---- pending_updates SELECT ----

    def pending_updates_select(self, report_id: uuid.UUID) -> bool:
        role = profile_role(self.p)
        if role in ("admin_xa", "lanh_dao"):
            return True
        return can_select_report(self.p, report_id)

    # ---- pending_updates INSERT/UPDATE/DELETE ----

    def pending_updates_write(self) -> bool:
        # Không có authenticated policy → chặn; service_role bypass RLS
        return False

    # ---- audit_log SELECT ----

    def audit_log_select(self) -> bool:
        return profile_role(self.p) == "admin_xa"

    # ---- audit_log INSERT/UPDATE/DELETE ----

    def audit_log_write(self) -> bool:
        # Không có authenticated policy → chặn; service_role bypass RLS
        return False

    # ---- report_periods SELECT ----

    def report_periods_select(self) -> bool:
        return self.p is not None  # bất kỳ authenticated nào cũng đọc được

    # ---- report_periods direct INSERT/UPDATE ----

    def report_periods_write(self) -> bool:
        # Period creation and change are allowed only through audited RPCs.
        return False


# ---------------------------------------------------------------------------
# TEST MATRIX — một test class cho mỗi bảng
# ---------------------------------------------------------------------------

@pytest.fixture(params=list(PROFILES.keys()))
def actor_name(request):
    return request.param


def _ev(name: str) -> _PolicyEvaluator:
    return _PolicyEvaluator(PROFILES[name])


# ── villages ──────────────────────────────────────────────────────────────────

class TestVillages:

    def test_select_anon_allowed(self):
        """anon được SELECT villages (cổng xem công khai)."""
        assert _ev("anon").villages_select() is True

    def test_select_all_roles_allowed(self):
        """Mọi role đều SELECT được."""
        for name in PROFILES:
            assert _ev(name).villages_select() is True, f"{name} should select"

    def test_write_blocked_for_all(self):
        """Không role nào ghi được villages qua client."""
        for name in PROFILES:
            assert _ev(name).villages_write() is False, f"{name} should NOT write"


# ── reports ───────────────────────────────────────────────────────────────────

class TestReports:
    REPORT_OWN = REPORTS[REPORT_A]    # thuộc VILLAGE_A
    REPORT_OTHER = REPORTS[REPORT_B]  # thuộc VILLAGE_B

    # SELECT
    def test_admin_xa_select_all_villages(self):
        assert _ev("admin_xa").reports_select(self.REPORT_OWN)   is True
        assert _ev("admin_xa").reports_select(self.REPORT_OTHER) is True

    def test_lanh_dao_select_all_villages(self):
        assert _ev("lanh_dao").reports_select(self.REPORT_OWN)   is True
        assert _ev("lanh_dao").reports_select(self.REPORT_OTHER) is True

    def test_can_bo_thon_select_own_only(self):
        assert _ev("can_bo_thon_A").reports_select(self.REPORT_OWN)   is True
        assert _ev("can_bo_thon_A").reports_select(self.REPORT_OTHER) is False

    def test_can_bo_thon_B_select_other_only(self):
        report_b_row = REPORTS[REPORT_B]
        assert _ev("can_bo_thon_B").reports_select(report_b_row) is True
        assert _ev("can_bo_thon_B").reports_select(self.REPORT_OWN) is False

    def test_dan_cannot_select_reports(self):
        """dan (role='dan') không nằm trong can_select_village → bị chặn."""
        assert _ev("dan").reports_select(self.REPORT_OWN) is False

    def test_anon_cannot_select_reports(self):
        assert _ev("anon").reports_select(self.REPORT_OWN) is False

    # INSERT
    def test_can_bo_thon_insert_own_village(self):
        assert _ev("can_bo_thon_A").reports_insert(VILLAGE_A) is True

    def test_can_bo_thon_insert_other_village_blocked(self):
        assert _ev("can_bo_thon_A").reports_insert(VILLAGE_B) is False

    def test_can_bo_thon_locked_insert_blocked(self):
        """force_password_reset=True → bị chặn ghi."""
        assert _ev("can_bo_thon_A_locked").reports_insert(VILLAGE_A) is False

    def test_admin_xa_cannot_insert_via_can_modify(self):
        """admin_xa không phải can_bo_thon → không INSERT qua policy này."""
        assert _ev("admin_xa").reports_insert(VILLAGE_A) is False

    def test_lanh_dao_cannot_insert(self):
        assert _ev("lanh_dao").reports_insert(VILLAGE_A) is False

    # UPDATE
    def test_can_bo_thon_update_own(self):
        assert _ev("can_bo_thon_A").reports_update(self.REPORT_OWN) is True

    def test_can_bo_thon_update_other_blocked(self):
        assert _ev("can_bo_thon_A").reports_update(self.REPORT_OTHER) is False

    def test_admin_xa_update_all(self):
        assert _ev("admin_xa").reports_update(self.REPORT_OWN)   is True
        assert _ev("admin_xa").reports_update(self.REPORT_OTHER) is True

    def test_lanh_dao_cannot_update(self):
        """lanh_dao chỉ đọc, không UPDATE."""
        assert _ev("lanh_dao").reports_update(self.REPORT_OWN) is False

    # DELETE
    def test_admin_xa_delete_any(self):
        assert _ev("admin_xa").reports_delete(self.REPORT_OWN)   is True
        assert _ev("admin_xa").reports_delete(self.REPORT_OTHER) is True

    def test_can_bo_thon_cannot_delete(self):
        assert _ev("can_bo_thon_A").reports_delete(self.REPORT_OWN) is False

    def test_lanh_dao_cannot_delete(self):
        assert _ev("lanh_dao").reports_delete(self.REPORT_OWN) is False

    def test_anon_cannot_delete(self):
        assert _ev("anon").reports_delete(self.REPORT_OWN) is False


# ── report_values ─────────────────────────────────────────────────────────────

class TestReportValues:

    def test_admin_xa_select_all(self):
        assert _ev("admin_xa").report_values_select(REPORT_A) is True
        assert _ev("admin_xa").report_values_select(REPORT_B) is True

    def test_lanh_dao_select_all(self):
        assert _ev("lanh_dao").report_values_select(REPORT_A) is True

    def test_can_bo_thon_select_own(self):
        assert _ev("can_bo_thon_A").report_values_select(REPORT_A) is True
        assert _ev("can_bo_thon_A").report_values_select(REPORT_B) is False

    def test_can_bo_thon_insert_own(self):
        assert _ev("can_bo_thon_A").report_values_insert(REPORT_A) is True
        assert _ev("can_bo_thon_A").report_values_insert(REPORT_B) is False

    def test_admin_xa_update_all(self):
        assert _ev("admin_xa").report_values_update(REPORT_A) is True
        assert _ev("admin_xa").report_values_update(REPORT_B) is True

    def test_can_bo_thon_update_own(self):
        assert _ev("can_bo_thon_A").report_values_update(REPORT_A) is True
        assert _ev("can_bo_thon_A").report_values_update(REPORT_B) is False

    def test_admin_xa_delete(self):
        assert _ev("admin_xa").report_values_delete(REPORT_A) is True

    def test_can_bo_thon_cannot_delete(self):
        assert _ev("can_bo_thon_A").report_values_delete(REPORT_A) is False

    def test_lanh_dao_cannot_delete(self):
        assert _ev("lanh_dao").report_values_delete(REPORT_A) is False


# ── pending_updates ───────────────────────────────────────────────────────────

class TestPendingUpdates:

    def test_admin_xa_select_all(self):
        assert _ev("admin_xa").pending_updates_select(REPORT_A) is True
        assert _ev("admin_xa").pending_updates_select(REPORT_B) is True

    def test_lanh_dao_select_all(self):
        assert _ev("lanh_dao").pending_updates_select(REPORT_A) is True

    def test_can_bo_thon_select_own(self):
        assert _ev("can_bo_thon_A").pending_updates_select(REPORT_A) is True
        assert _ev("can_bo_thon_A").pending_updates_select(REPORT_B) is False

    def test_anon_cannot_select(self):
        assert _ev("anon").pending_updates_select(REPORT_A) is False

    def test_nobody_can_write_via_client(self):
        """Không ai ghi pending_updates qua client authenticated."""
        for name in PROFILES:
            assert _ev(name).pending_updates_write() is False, (
                f"{name} should NOT write pending_updates directly. "
                "Must go through service_role backend."
            )


# ── audit_log ─────────────────────────────────────────────────────────────────

class TestAuditLog:

    def test_admin_xa_can_select(self):
        assert _ev("admin_xa").audit_log_select() is True

    def test_lanh_dao_cannot_select(self):
        assert _ev("lanh_dao").audit_log_select() is False

    def test_can_bo_thon_cannot_select(self):
        assert _ev("can_bo_thon_A").audit_log_select() is False

    def test_anon_cannot_select(self):
        assert _ev("anon").audit_log_select() is False

    def test_nobody_can_write_audit_log(self):
        """audit_log là append-only từ service_role; không ai client ghi được."""
        for name in PROFILES:
            assert _ev(name).audit_log_write() is False, (
                f"{name} should NOT write audit_log from client."
            )


# ── report_periods ────────────────────────────────────────────────────────────

class TestReportPeriods:

    def test_all_authenticated_can_select(self):
        for name in [k for k in PROFILES if k != "anon"]:
            assert _ev(name).report_periods_select() is True

    def test_anon_cannot_select(self):
        assert _ev("anon").report_periods_select() is False

    def test_every_role_is_blocked_from_direct_write(self):
        for name in PROFILES:
            assert _ev(name).report_periods_write() is False


# ---------------------------------------------------------------------------
# Bảng kết quả ASCII (in khi chạy pytest -s)
# ---------------------------------------------------------------------------

def _cell(val: bool) -> str:
    return "✅ Được" if val else "❌ Chặn"


def print_matrix() -> None:
    """In ma tran quyen dang bang ASCII cho moi role x hanh dong x tai nguyen."""
    roles = [
        ("admin_xa",          "admin_xa"),
        ("lanh_dao",          "lanh_dao"),
        ("can_bo_thon_A",     "can_bo_thon (thon A)"),
        ("can_bo_thon_B",     "can_bo_thon (thon B)"),
        ("can_bo_thon_A_locked", "can_bo_thon (chua doi mk)"),
        ("to_cnscd_A",        "to_cnscd (thon A)"),
        ("dan",               "dan"),
        ("anon",              "anon (chua dang nhap)"),
    ]

    report_a_row = REPORTS[REPORT_A]
    report_b_row = REPORTS[REPORT_B]

    # Header
    cols = [
        "villages\nSELECT",
        "villages\nWRITE",
        "reports(A)\nSELECT",
        "reports(B)\nSELECT",
        "reports(A)\nINSERT",
        "reports(A)\nUPDATE",
        "reports(A)\nDELETE",
        "rep_values\nSELECT A",
        "rep_values\nDELETE",
        "pending_upd\nSELECT A",
        "pending_upd\nWRITE",
        "audit_log\nSELECT",
        "audit_log\nWRITE",
        "rep_period\nWRITE",
    ]

    role_col_width = 28
    cell_width = 9
    header_row1 = f"{'Role':<{role_col_width}}"
    for c in cols:
        top = c.split("\n")[0]
        header_row1 += f" {top:^{cell_width}}"
    header_row2 = " " * role_col_width
    for c in cols:
        bot = c.split("\n")[1]
        header_row2 += f" {bot:^{cell_width}}"


    sep  = "=" * 110
    thin = "-" * 110

    print("\n" + sep)
    print("  MA TRAN QUYEN RLS - Ba Na SmartLink")
    print("  (Tai nguyen thuoc Thon A; report_A in Thon A, report_B in Thon B)")
    print(sep)
    print(header_row1)
    print(header_row2)
    print(thin)

    for key, label in roles:
        ev = _ev(key)
        row_data = [
            _cell(ev.villages_select()),
            _cell(ev.villages_write()),
            _cell(ev.reports_select(report_a_row)),
            _cell(ev.reports_select(report_b_row)),
            _cell(ev.reports_insert(VILLAGE_A)),
            _cell(ev.reports_update(report_a_row)),
            _cell(ev.reports_delete(report_a_row)),
            _cell(ev.report_values_select(REPORT_A)),
            _cell(ev.report_values_delete(REPORT_A)),
            _cell(ev.pending_updates_select(REPORT_A)),
            _cell(ev.pending_updates_write()),
            _cell(ev.audit_log_select()),
            _cell(ev.audit_log_write()),
            _cell(ev.report_periods_write()),
        ]
        line = f"{label:<{role_col_width}}"
        for cell in row_data:
            sym = "OK " if "Duoc" in cell or "Được" in cell else "NO "
            line += f" {sym:^{cell_width}}"
        print(line)

    print(sep)
    print()
    print("Ghi chu:")
    print("  OK  = Duoc phep  |  NO  = Bi chan")
    print("  * pending_updates/audit_log WRITE (NO tat ca): chi service_role tu backend.")
    print("  * villages/village_merge_map WRITE (NO tat ca): chi migrate_and_seed.py.")
    print("  * can_bo_thon chua doi mat khau: bi khoa, chi SELECT thon minh.")
    print()


# In bảng kết quả cuối bộ test
def test_print_matrix_at_end():
    """Test cuoi: in bang ma tran quyen de review."""
    print_matrix()
    assert True
