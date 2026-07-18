from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_container_applies_narrow_release_overlay_before_startup() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "python migrate.py --release-overlays && exec python -m uvicorn" in dockerfile
    assert "python migrate.py && exec" not in dockerfile
    assert "python migrate.py --baseline" not in dockerfile
