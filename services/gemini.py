from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

import httpx

from services.settings import Settings, load_settings


class GeminiError(RuntimeError):
    """Raised when Gemini validation cannot be completed."""


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
        except json.JSONDecodeError as exc:
            raise GeminiError("Gemini returned invalid JSON") from exc
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
        except httpx.HTTPError as exc:
            raise GeminiError("Gemini request failed") from exc

        if response.status_code >= 400:
            raise GeminiError("Gemini request failed")

        return _extract_text(response.json())


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
