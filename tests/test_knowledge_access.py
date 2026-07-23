from pathlib import Path

from services.chatbot import _knowledge_audiences


def test_chatbot_knowledge_audiences_are_additive_and_role_scoped():
    assert _knowledge_audiences("dan") == ["public"]
    assert _knowledge_audiences("to_cnscd") == ["public", "champions"]
    assert _knowledge_audiences("can_bo_thon") == ["public", "internal"]
    assert _knowledge_audiences("lanh_dao") == ["public", "internal", "champions"]
    assert _knowledge_audiences("admin_xa") == ["public", "internal", "champions"]
    assert _knowledge_audiences("unknown") == ["public"]


def test_knowledge_migration_hides_drafts_and_scopes_revisions():
    sql = (
        Path(__file__).parents[1]
        / "migrations"
        / "20260723_0017_knowledge_access_hardening.sql"
    ).read_text(encoding="utf-8").lower()

    assert "drop policy if exists knowledge_select_internal" in sql
    assert "status = 'approved'" in sql
    assert "profile_role() = 'admin_xa'" in sql
    assert "profile_role() = 'lanh_dao'" in sql
    assert "profile_role() = 'can_bo_thon'" in sql
    assert "profile_role() = 'to_cnscd'" in sql
    assert "knowledge_revisions_select_by_role" in sql
