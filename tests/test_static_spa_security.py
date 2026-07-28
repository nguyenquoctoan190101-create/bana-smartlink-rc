from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from main import create_app


def test_spa_serves_only_preindexed_files_and_rejects_traversal(
    tmp_path: Path,
) -> None:
    dist_root = tmp_path / "dist"
    assets_root = dist_root / "assets"
    assets_root.mkdir(parents=True)
    (dist_root / "index.html").write_text("trusted-index", encoding="utf-8")
    (dist_root / "manifest.webmanifest").write_text(
        '{"name":"Ba Na SmartLink"}',
        encoding="utf-8",
    )
    outside_file = tmp_path / "outside.txt"
    outside_file.write_text("must-never-be-served", encoding="utf-8")

    client = TestClient(create_app(static_root=dist_root))

    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert "Ba Na SmartLink" in manifest.text

    traversal = client.get("/%2e%2e/outside.txt")
    assert traversal.status_code == 404
    assert "must-never-be-served" not in traversal.text

    client_route = client.get("/app/operations")
    assert client_route.status_code == 200
    assert client_route.text == "trusted-index"
