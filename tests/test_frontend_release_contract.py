from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_CT05_LABEL = "Số người có công với cách mạng đang được quản lý"


def test_desktop_sidebar_keeps_logout_visible_while_navigation_scrolls() -> None:
    app_source = (ROOT / "src" / "App.tsx").read_text(encoding="utf-8")
    stylesheet = (ROOT / "src" / "index.css").read_text(encoding="utf-8")

    assert 'className="gov-shell__sidebar-scroll flex min-h-0 flex-1 flex-col"' in app_source
    assert 'className="shrink-0 p-4 border-t border-emerald-900 space-y-2"' in app_source
    assert ".gov-shell__sidebar-scroll" in stylesheet
    assert "overflow-y: auto" in stylesheet
    assert ".gov-shell__sidebar {" in stylesheet
    assert "overflow: hidden" in stylesheet


def test_ct05_uses_one_canonical_business_label_in_both_rule_bundles() -> None:
    backend_rules = json.loads(
        (ROOT / "config" / "validation_rules.json").read_text(encoding="utf-8")
    )
    frontend_rules = json.loads(
        (ROOT / "src" / "validation_rules.json").read_text(encoding="utf-8")
    )
    metric_registry = json.loads(
        (ROOT / "config" / "metric_registry.json").read_text(
            encoding="utf-8"
        )
    )

    backend_ct05 = next(
        rule for rule in backend_rules["indicators"] if rule["code"] == "CT05"
    )
    assert backend_ct05["name"] == CANONICAL_CT05_LABEL
    assert frontend_rules["CT05"]["name"] == CANONICAL_CT05_LABEL
    registry_ct05 = next(
        metric
        for metric in metric_registry["metrics"]
        if metric["metric_id"] == "CT05"
    )
    assert registry_ct05["label_vi"] == CANONICAL_CT05_LABEL


def test_metric_registry_public_boundary_matches_release_inventory() -> None:
    metric_registry = json.loads(
        (ROOT / "config" / "metric_registry.json").read_text(
            encoding="utf-8"
        )
    )
    inventory = json.loads(
        (ROOT / "tests" / "route_authorization_inventory.json").read_text(
            encoding="utf-8"
        )
    )

    assert metric_registry["public_raw_metric_ids"] == inventory[
        "public_indicator_codes"
    ]
    assert all(
        metric["kind"] == "raw"
        and metric["metric_id"] in inventory["public_indicator_codes"]
        for metric in metric_registry["metrics"]
        if metric["public"]
    )


def test_release_image_revision_is_not_the_stale_july_22_layer() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert 'ARG BUILD_REVISION="2026-07-23-audit-1"' in dockerfile
    assert 'ARG BUILD_REVISION="8649709"' not in dockerfile
