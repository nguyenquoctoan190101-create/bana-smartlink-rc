from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"


def test_all_github_actions_are_pinned_to_immutable_commits() -> None:
    action_uses: list[tuple[str, str, str]] = []
    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        text = workflow.read_text(encoding="utf-8")
        for action, ref in re.findall(r"uses:\s+([^@\s]+)@([^\s#]+)", text):
            action_uses.append((workflow.name, action, ref))

    assert action_uses
    assert [
        (workflow, action, ref)
        for workflow, action, ref in action_uses
        if re.fullmatch(r"[0-9a-f]{40}", ref) is None
    ] == []


def test_ci_avoids_duplicate_feature_branch_runs_and_reviews_dependencies() -> None:
    workflow = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")

    assert workflow.count("branches: [main]") >= 2
    assert "actions/dependency-review-action@" in workflow
    assert "fail-on-severity: moderate" in workflow
    assert "migrations/20260727_*.sql" in workflow


def test_codeql_covers_both_application_languages_with_minimal_permissions() -> None:
    workflow = (WORKFLOWS / "codeql.yml").read_text(encoding="utf-8")

    assert "security-events: write" in workflow
    assert "contents: read" in workflow
    assert "javascript-typescript" in workflow
    assert "python" in workflow
    assert "build-mode: none" in workflow
    assert "github/codeql-action/init@" in workflow
    assert "github/codeql-action/analyze@" in workflow


def test_dependabot_covers_actions_node_and_python() -> None:
    config = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")

    assert config.count("package-ecosystem:") == 3
    for ecosystem in ("github-actions", "npm", "pip"):
        assert f"package-ecosystem: {ecosystem}" in config
    assert config.count("open-pull-requests-limit: 5") == 3
