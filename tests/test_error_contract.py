from __future__ import annotations

from fastapi import HTTPException, Query
from fastapi.testclient import TestClient

from main import create_app


def _prepend_test_route(app, path: str, endpoint) -> None:
    """Register a test route before the production SPA catch-all."""
    app.add_api_route(path, endpoint)
    app.router.routes.insert(0, app.router.routes.pop())


def test_handled_http_error_uses_public_contract_and_request_id() -> None:
    app = create_app()

    async def conflict() -> None:
        raise HTTPException(status_code=409, detail="Bản ghi đã được xử lý trước đó.")

    _prepend_test_route(app, "/__test/conflict", conflict)
    response = TestClient(app).get(
        "/__test/conflict",
        headers={"X-Request-ID": "req-contract-409"},
    )

    assert response.status_code == 409
    assert response.headers["X-Request-ID"] == "req-contract-409"
    assert response.json() == {
        "code": "CONFLICT",
        "message": "Bản ghi đã được xử lý trước đó.",
        "details": None,
        "request_id": "req-contract-409",
    }


def test_request_validation_does_not_echo_submitted_value() -> None:
    app = create_app()

    async def validate(required_number: int = Query(...)) -> dict[str, int]:
        return {"required_number": required_number}

    _prepend_test_route(app, "/__test/validate", validate)
    submitted_value = "secret-value-that-must-not-be-echoed"
    response = TestClient(app).get(
        "/__test/validate",
        params={"required_number": submitted_value},
        headers={"X-Request-ID": "req-contract-422"},
    )

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    assert payload["message"] == "Dữ liệu yêu cầu không hợp lệ."
    assert payload["request_id"] == "req-contract-422"
    assert payload["details"][0]["field"] == "query.required_number"
    assert set(payload["details"][0]) == {"field", "message", "type"}
    assert submitted_value not in response.text


def test_unhandled_error_is_redacted_and_has_request_id() -> None:
    app = create_app()

    async def crash() -> None:
        raise RuntimeError("database password and raw SQL must stay private")

    _prepend_test_route(app, "/__test/crash", crash)
    response = TestClient(app, raise_server_exceptions=False).get(
        "/__test/crash",
        headers={"X-Request-ID": "req-contract-500"},
    )

    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == "req-contract-500"
    assert response.json() == {
        "code": "INTERNAL_ERROR",
        "message": "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.",
        "details": None,
        "request_id": "req-contract-500",
    }
    assert "database password" not in response.text
