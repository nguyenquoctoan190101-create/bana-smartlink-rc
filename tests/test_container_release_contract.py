from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_container_applies_narrow_release_overlay_before_startup() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "python migrate.py --release-overlays && exec python -m uvicorn" in dockerfile
    assert "python migrate.py && exec" not in dockerfile
    assert "python migrate.py --baseline" not in dockerfile


def test_container_installs_runtime_dependencies_only() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    production = (ROOT / "requirements-prod.txt").read_text(encoding="utf-8")

    assert "requirements-prod.txt" in dockerfile
    assert "requirements.txt" not in dockerfile
    assert "pytest" not in production
    assert "ruff" not in production


def test_proxy_trust_is_closed_by_default() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    render = (ROOT / "render.yaml").read_text(encoding="utf-8")

    assert "FORWARDED_ALLOW_IPS:-127.0.0.1" in dockerfile
    assert "key: FORWARDED_ALLOW_IPS" in render


def test_render_keeps_external_ocr_release_locked() -> None:
    render = (ROOT / "render.yaml").read_text(encoding="utf-8")

    assert "key: FEATURE_EXTERNAL_OCR\n        value: \"false\"" in render
