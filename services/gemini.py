from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from typing import Any

import httpx

from services.settings import Settings, load_settings


logger = logging.getLogger(__name__)
_ERROR_TOKEN_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_FIELD_PATH_RE = re.compile(r"^[A-Za-z0-9_.$\[\]/-]{1,200}$")


class GeminiError(RuntimeError):
    """Raised when Gemini validation cannot be completed."""


def _gemini_error_metadata(response: httpx.Response) -> dict[str, Any]:
    """Return bounded provider diagnostics without response or request content."""
    metadata: dict[str, Any] = {
        "gemini_http_status": response.status_code,
        "gemini_error_class": "provider_error",
    }
    try:
        payload = response.json()
    except ValueError:
        return metadata
    if not isinstance(payload, dict) or not isinstance(payload.get("error"), dict):
        return metadata

    error = payload["error"]
    status = error.get("status")
    if isinstance(status, str) and _ERROR_TOKEN_RE.fullmatch(status):
        metadata["gemini_provider_status"] = status

    reasons: list[str] = []
    field_paths: list[str] = []
    details = error.get("details")
    if isinstance(details, list):
        for detail in details:
            if not isinstance(detail, dict):
                continue
            reason = detail.get("reason")
            if (
                isinstance(reason, str)
                and _ERROR_TOKEN_RE.fullmatch(reason)
                and reason not in reasons
            ):
                reasons.append(reason)
            violations = detail.get("fieldViolations")
            if not isinstance(violations, list):
                continue
            for violation in violations:
                if not isinstance(violation, dict):
                    continue
                field = violation.get("field")
                if (
                    isinstance(field, str)
                    and _FIELD_PATH_RE.fullmatch(field)
                    and field not in field_paths
                ):
                    field_paths.append(field)

    if reasons:
        metadata["gemini_error_reasons"] = reasons[:3]
    if field_paths:
        metadata["gemini_error_fields"] = field_paths[:3]

    message = error.get("message")
    normalized_message = message.lower() if isinstance(message, str) else ""
    normalized_fields = " ".join(field_paths).lower()
    normalized_reasons = set(reasons)
    if (
        "api key not valid" in normalized_message
        or "api_key_invalid" in normalized_message
        or "API_KEY_INVALID" in normalized_reasons
        or status == "UNAUTHENTICATED"
    ):
        error_class = "authentication"
    elif (
        status == "RESOURCE_EXHAUSTED"
        or "quota" in normalized_message
        or "rate limit" in normalized_message
    ):
        error_class = "quota"
    elif status == "PERMISSION_DENIED" or "permission denied" in normalized_message:
        error_class = "permission"
    elif (
        ("model" in normalized_message and "not found" in normalized_message)
        or "not supported for generatecontent" in normalized_message
    ):
        error_class = "model_unavailable"
    elif (
        "schema" in normalized_message
        or "schema" in normalized_fields
        or "responsejsonschema" in normalized_message
    ):
        error_class = "schema"
    elif status == "INVALID_ARGUMENT":
        error_class = "invalid_argument"
    else:
        error_class = "provider_error"
    metadata["gemini_error_class"] = error_class
    return metadata


def _gemini_request_mode(payload: dict[str, Any]) -> str:
    generation_config = payload.get("generationConfig")
    if (
        isinstance(generation_config, dict)
        and "responseJsonSchema" in generation_config
    ):
        return "json_schema"
    return "text"


class GeminiClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def validate_aggregate_report(
        self,
        values: dict[str, int | None],
        validation_flags: list[dict[str, str]],
    ) -> str:
        """Ask Gemini for warnings only, using aggregate indicator data."""
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": (
                                "Ba Na SmartLink report validation. "
                                "Use only aggregate CT01-CT14 values and existing flags. "
                                "Never infer or repair data. Return warnings/errors only.\n"
                                f"values={values}\nflags={validation_flags}"
                            )
                        }
                    ]
                }
            ]
        }
        return await self._generate_content(payload)

    async def generate_text(
        self,
        system_prompt: str,
        user_text: str,
        max_output_tokens: int = 512,
        temperature: float = 0.2,
    ) -> str:
        """Generate text with the already configured Gemini model."""
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_text}],
                }
            ],
            "generationConfig": {
                "maxOutputTokens": max_output_tokens,
                "temperature": temperature,
            },
        }
        return await self._generate_content(payload)

    async def generate_json(
        self,
        system_prompt: str,
        user_text: str,
        response_json_schema: dict[str, Any],
        max_output_tokens: int = 256,
    ) -> dict[str, Any]:
        """Generate a schema-constrained JSON object.

        Callers must still validate every field against their own allowlists;
        the schema improves shape reliability but is not an authorization
        boundary.
        """
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_text}],
                }
            ],
            "generationConfig": {
                "maxOutputTokens": max_output_tokens,
                "responseMimeType": "application/json",
                # Gemini's current structured-output contract accepts JSON
                # Schema here. The older responseSchema field expects a
                # different OpenAPI-shaped dialect and is deprecated.
                "responseJsonSchema": response_json_schema,
            },
        }
        raw = await self._generate_content(payload)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # Do not retain the model output through JSONDecodeError.doc.
            raise GeminiError("Gemini returned invalid JSON") from None
        if not isinstance(parsed, dict):
            raise GeminiError("Gemini returned invalid JSON")
        return parsed

    def _gemini_url(self) -> str:
        base_url = self._settings.gemini_api_url.rstrip("/")
        model = self._settings.gemini_model
        return f"{base_url}/v1beta/models/{model}:generateContent"

    async def _generate_content(self, payload: dict[str, Any]) -> str:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(
                    self._gemini_url(),
                    # Never put credentials in the URL: HTTP access logs record
                    # request targets. Google's documented header keeps the key
                    # out of log lines and tracing metadata.
                    headers={
                        "x-goog-api-key": self._settings.gemini_api_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError:
            # Transport exception strings may contain sensitive connection
            # metadata. Keep them out of future traceback/Sentry capture.
            raise GeminiError("Gemini request failed") from None

        if response.status_code >= 400:
            logger.warning(
                "Gemini provider request rejected",
                extra={
                    "gemini_model": self._settings.gemini_model,
                    "gemini_request_mode": _gemini_request_mode(payload),
                    **_gemini_error_metadata(response),
                },
            )
            raise GeminiError("Gemini request failed")

        try:
            response_payload = response.json()
        except ValueError:
            logger.warning(
                "Gemini provider returned invalid JSON",
                extra={
                    "gemini_model": self._settings.gemini_model,
                    "gemini_request_mode": _gemini_request_mode(payload),
                    "gemini_http_status": response.status_code,
                    "gemini_error_class": "invalid_response_json",
                },
            )
            raise GeminiError("Unexpected Gemini response") from None
        return _extract_text(response_payload)


def _extract_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        raise GeminiError("Unexpected Gemini response")

    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise GeminiError("Unexpected Gemini response")

    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        raise GeminiError("Unexpected Gemini response")

    content = first_candidate.get("content")
    if not isinstance(content, dict):
        raise GeminiError("Unexpected Gemini response")

    parts = content.get("parts")
    if not isinstance(parts, list) or not parts:
        raise GeminiError("Unexpected Gemini response")

    # Thinking-capable models may return metadata-only or thought parts before
    # the final answer. Read every non-thought text part instead of assuming
    # the first part contains the user-visible response.
    text_parts = [
        part["text"]
        for part in parts
        if isinstance(part, dict)
        and isinstance(part.get("text"), str)
        and part.get("thought") is not True
    ]
    if not text_parts:
        raise GeminiError("Unexpected Gemini response")

    return "".join(text_parts)


@lru_cache
def get_gemini_client() -> GeminiClient:
    """Reuse the configured Gemini client across chatbot and AI routes."""
    return GeminiClient(load_settings())


__all__ = ["GeminiClient", "GeminiError", "get_gemini_client"]
