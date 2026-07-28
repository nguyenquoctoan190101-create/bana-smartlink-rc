from __future__ import annotations

from fastapi.testclient import TestClient

from main import create_app


def test_browser_security_headers_are_applied(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    response = TestClient(create_app()).get("/health/live")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-permitted-cross-domain-policies"] == "none"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cross-origin-opener-policy"] == "same-origin"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_role_scoped_api_responses_are_not_cacheable(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    response = TestClient(create_app()).get("/auth/me")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store, max-age=0"
    assert response.headers["pragma"] == "no-cache"


def test_static_health_response_is_not_forced_to_no_store(monkeypatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    response = TestClient(create_app()).get("/health/live")

    assert "cache-control" not in response.headers


def test_hashed_assets_are_immutable_but_spa_shell_revalidates(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "development")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-contenthash.js").write_text("export {};", encoding="utf-8")
    (tmp_path / "index.html").write_text("<!doctype html><title>App</title>", encoding="utf-8")
    (tmp_path / "service-worker.js").write_text("self.skipWaiting();", encoding="utf-8")
    client = TestClient(create_app(static_root=tmp_path))

    asset = client.get("/assets/index-contenthash.js")
    missing_asset = client.get("/assets/missing-contenthash.js")
    root = client.get("/")
    spa_route = client.get("/app/operations")
    worker = client.get("/service-worker.js")

    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert missing_asset.status_code == 404
    assert "cache-control" not in missing_asset.headers
    assert root.headers["cache-control"] == "no-cache"
    assert spa_route.headers["cache-control"] == "no-cache"
    assert worker.headers["cache-control"] == "no-cache"
