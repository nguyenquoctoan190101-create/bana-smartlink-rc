from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.cnscd_impact import router as cnscd_impact_router
from routers.cases import router as cases_router
from routers.knowledge import router as knowledge_router
from routers.pilots import router as pilots_router
from routers.policy_scorecard import router as policy_scorecard_router
from routers.operations import router as operations_router
from routers.reports import period_router, router as reports_router
from routers.report_imports import router as report_imports_router
from routers.push import router as push_router, api_router
from services.logger import get_logger  # noqa: F401  — side-effect: initialises Sentry + JSON logging
from services.rate_limit import limiter
from services.settings import load_settings

_log = get_logger(__name__)


_HTTP_ERROR_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    502: "UPSTREAM_ERROR",
    503: "SERVICE_UNAVAILABLE",
}


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _http_error_content(
    request: Request,
    exc: StarletteHTTPException,
) -> dict[str, object | None]:
    """Convert every handled HTTP error to the public API error contract."""
    detail = exc.detail
    code = _HTTP_ERROR_CODES.get(exc.status_code, "HTTP_ERROR")
    details: object | None = None

    if isinstance(detail, dict):
        raw_code = detail.get("code")
        if isinstance(raw_code, str) and raw_code:
            code = raw_code.upper()
        raw_message = detail.get("message")
        message = raw_message if isinstance(raw_message, str) else "Yêu cầu không hợp lệ."
        details = detail.get("details")
    elif isinstance(detail, str):
        message = detail
    else:
        message = "Yêu cầu không hợp lệ."
        details = detail

    # Upstream and server-side implementation details are never a public response.
    if exc.status_code >= 500:
        message = "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút."
        details = None

    return {
        "code": code,
        "message": message,
        "details": details,
        "request_id": _request_id(request),
    }


def _validation_details(exc: RequestValidationError) -> list[dict[str, str]]:
    """Expose only field, message and type; never echo the submitted body."""
    return [
        {
            "field": ".".join(str(part) for part in error.get("loc", ())),
            "message": str(error.get("msg", "Giá trị không hợp lệ")),
            "type": str(error.get("type", "value_error")),
        }
        for error in exc.errors()
    ]


def create_app() -> FastAPI:
    """Create the FastAPI app with security middleware configured."""
    settings = load_settings()
    app = FastAPI(title="Ba Na SmartLink API")

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        # Media/GPS are opt-in capabilities.  The browser still prompts the
        # user only when a feature explicitly calls getUserMedia/getCurrentPosition;
        # denying the feature at the policy layer made the planned voice/GPS
        # workflows impossible even after a user granted permission.
        response.headers["Permissions-Policy"] = (
            "camera=(self), microphone=(self), geolocation=(self)"
        )
        connect_sources = ["'self'"]
        parsed_supabase = urlsplit(settings.normalized_supabase_url)
        if parsed_supabase.scheme == "https" and parsed_supabase.netloc:
            connect_sources.append(f"https://{parsed_supabase.netloc}")
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; object-src 'none'; img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            f"connect-src {' '.join(connect_sources)}; worker-src 'self'; "
            "manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        if settings.app_env.lower() in {"staging", "production"}:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
        _ = exc
        return JSONResponse(
            status_code=429,
            content={
                "code": "RATE_LIMITED",
                "message": "Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.",
                "details": None,
                "request_id": _request_id(request),
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_http_error_content(request, exc),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _request_validation_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "message": "Dữ liệu yêu cầu không hợp lệ.",
                "details": _validation_details(exc),
                "request_id": _request_id(request),
            },
        )

    @app.exception_handler(Exception)
    async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Catch-all: log every unhandled 500 error with structured context."""
        _log.error(
            "Unhandled server error",
            exc_info=exc,
            extra={
                "path": str(request.url.path),
                "method": request.method,
                "client": request.client.host if request.client else "unknown",
            },
        )
        # Capture to Sentry if configured
        try:
            import sentry_sdk  # type: ignore[import]
            sentry_sdk.capture_exception(exc)
        except ImportError:
            pass
        request_id = _request_id(request) or str(uuid4())
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "Hệ thống đang tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.",
                "details": None,
                "request_id": request_id,
            },
            # Unhandled exceptions are rendered by Starlette's outer error
            # middleware, so the normal response middleware cannot append this
            # correlation header afterwards.
            headers={"X-Request-ID": request_id},
        )

    configured_origins = [
        origin.strip()
        for origin in settings.allowed_origin.split(",")
        if origin.strip()
    ]
    if settings.app_env.lower() == "development":
        configured_origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])
    configured_origins = list(dict.fromkeys(configured_origins))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        allow_credentials="*" not in configured_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(auth_router)
    app.include_router(ai_router)
    app.include_router(reports_router)
    app.include_router(period_router)
    app.include_router(report_imports_router)
    app.include_router(policy_scorecard_router, prefix="/api")
    app.include_router(operations_router, prefix="/api")
    app.include_router(cnscd_impact_router, prefix="/api")
    app.include_router(cases_router, prefix="/api")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(pilots_router, prefix="/api")
    app.include_router(push_router, prefix="/api")
    app.include_router(api_router, prefix="/api")

    @app.get("/health/live", tags=["health"])
    async def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    async def health_ready() -> dict[str, str]:
        if not settings.database_url or not settings.supabase_url:
            raise HTTPException(status_code=503, detail="Required services are not configured")
        try:
            import asyncpg

            connection = await asyncpg.connect(dsn=settings.database_url, timeout=2)
            try:
                await connection.fetchval("SELECT 1")
            finally:
                await connection.close()
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Database is not ready") from exc
        return {"status": "ready"}

    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    dist_root = Path("dist").resolve()
    if dist_root.is_dir():
        assets_root = dist_root / "assets"
        if assets_root.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_root), name="assets")

        @app.get("/{path_name:path}", include_in_schema=False)
        async def serve_spa(path_name: str):
            candidate = (dist_root / path_name).resolve()
            try:
                candidate.relative_to(dist_root)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Asset not found") from exc
            if candidate.is_file():
                return FileResponse(candidate)
            
            # Do not serve index.html for API routes
            if (
                path_name.startswith("api/") or 
                path_name.startswith("reports/") or 
                path_name.startswith("report-imports/") or
                path_name.startswith("auth/") or 
                path_name.startswith("ai/") or 
                path_name in ("api", "reports", "report-imports", "auth", "ai")
            ):
                raise HTTPException(status_code=404, detail="API endpoint not found")

            # If the path looks like a static asset, return 404 instead of index.html
            # to prevent browser MIME-type mismatch crashes (e.g., loading HTML as JS/CSS)
            ext = candidate.suffix.lower()
            if ext in [".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".json", ".map", ".webmanifest"] or path_name.startswith("assets/"):
                raise HTTPException(status_code=404, detail="Asset not found")

            return FileResponse(dist_root / "index.html")

    return app


app = create_app()
