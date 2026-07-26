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
