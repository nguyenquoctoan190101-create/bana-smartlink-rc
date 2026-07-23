from fastapi.testclient import TestClient

from main import create_app


def test_live_health_exposes_render_release(monkeypatch) -> None:
    commit = "1234567890abcdef1234567890abcdef12345678"
    monkeypatch.setenv("RENDER_GIT_COMMIT", commit)

    response = TestClient(create_app()).get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": commit}


def test_live_health_has_safe_local_fallback(monkeypatch) -> None:
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    monkeypatch.delenv("APP_VERSION", raising=False)

    response = TestClient(create_app()).get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "development"}
