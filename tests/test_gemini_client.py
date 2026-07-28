from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.gemini import (
    GeminiClient,
    GeminiError,
    _extract_text,
    _gemini_error_metadata,
)
from services.settings import Settings


class FakeAsyncClient:
    def __init__(self, response=None, error=None, **kwargs):
        self.response = response
        self.error = error
        self.post = AsyncMock(side_effect=self._post)

    async def _post(self, *args, **kwargs):
        if self.error:
            raise self.error
        return self.response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _client() -> GeminiClient:
    return GeminiClient(Settings(
        _env_file=None,
        gemini_api_key="test-key",
        gemini_api_url="https://gemini.example/",
        gemini_model="test-model",
    ))


def _response(text: str = "Cảnh báo có nguồn") -> httpx.Response:
    return httpx.Response(200, json={
        "candidates": [{"content": {"parts": [{"text": text}]}}]
    })


@pytest.mark.asyncio
async def test_generate_text_builds_bounded_request_without_pii_side_channel() -> None:
    fake = FakeAsyncClient(_response())
    with patch("services.gemini.httpx.AsyncClient", return_value=fake):
        result = await _client().generate_text(
            "Chỉ tóm tắt dữ liệu tổng hợp.", "10 báo cáo hợp lệ.",
            max_output_tokens=128, temperature=0.1,
        )
    assert result == "Cảnh báo có nguồn"
    assert fake.post.await_args.args[0].endswith("/v1beta/models/test-model:generateContent")
    assert fake.post.await_args.kwargs["headers"]["x-goog-api-key"] == "test-key"
    assert "test-key" not in fake.post.await_args.args[0]
    assert "params" not in fake.post.await_args.kwargs
    payload = fake.post.await_args.kwargs["json"]
    assert payload["generationConfig"] == {"maxOutputTokens": 128, "temperature": 0.1}


@pytest.mark.asyncio
async def test_validate_aggregate_report_marks_ai_as_advisory_only() -> None:
    fake = FakeAsyncClient(_response("Không có cảnh báo mới"))
    with patch("services.gemini.httpx.AsyncClient", return_value=fake):
        result = await _client().validate_aggregate_report(
            {"CT01": 100, "CT14": None}, [{"ct_code": "CT14", "error_type": "BLANK"}]
        )
    assert result == "Không có cảnh báo mới"
    prompt = fake.post.await_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
    assert "Never infer or repair data" in prompt
    assert "values=" in prompt and "flags=" in prompt


@pytest.mark.asyncio
async def test_generate_json_uses_schema_constrained_deterministic_output() -> None:
    fake = FakeAsyncClient(_response('{"intent":"HELP"}'))
    schema = {
        "type": "OBJECT",
        "properties": {"intent": {"type": "STRING"}},
        "required": ["intent"],
    }
    with patch("services.gemini.httpx.AsyncClient", return_value=fake):
        result = await _client().generate_json("system", "question", schema)

    assert result == {"intent": "HELP"}
    config = fake.post.await_args.kwargs["json"]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseJsonSchema"] == schema
    assert "responseSchema" not in config
    assert "temperature" not in config


@pytest.mark.asyncio
async def test_generate_json_can_retry_with_bounded_json_mode_fallback(caplog) -> None:
    fake = FakeAsyncClient()
    fake.post = AsyncMock(side_effect=[
        httpx.Response(400, json={
            "error": {
                "status": "INVALID_ARGUMENT",
                "message": "Request contains provider-secret-invalid-detail.",
            }
        }),
        _response('{"intent":"HELP"}'),
    ])
    schema = {
        "type": "object",
        "properties": {"intent": {"type": "string", "enum": ["HELP"]}},
        "required": ["intent"],
        "additionalProperties": False,
    }

    with caplog.at_level("INFO", logger="services.gemini"):
        with patch("services.gemini.httpx.AsyncClient", return_value=fake):
            result = await _client().generate_json(
                "system",
                "question",
                schema,
                allow_json_mode_fallback=True,
            )

    assert result == {"intent": "HELP"}
    assert fake.post.await_count == 2
    structured = fake.post.await_args_list[0].kwargs["json"]
    fallback = fake.post.await_args_list[1].kwargs["json"]
    assert structured["generationConfig"]["responseJsonSchema"] == schema
    assert fallback["generationConfig"] == {
        "maxOutputTokens": 256,
        "responseMimeType": "application/json",
    }
    assert "responseJsonSchema" not in fallback["generationConfig"]
    assert "responseSchema" not in fallback["generationConfig"]
    assert "REQUIRED_OUTPUT_JSON_SCHEMA" in fallback["contents"][0]["parts"][0]["text"]
    assert '"additionalProperties":false' in fallback["contents"][0]["parts"][0]["text"]
    assert "provider-secret" not in caplog.text
    assert all("provider-secret" not in repr(record.__dict__) for record in caplog.records)
    assert [record.gemini_request_mode for record in caplog.records] == [
        "json_schema",
        "json_mime",
        "json_mime",
    ]
    assert caplog.records[1].gemini_fallback_reason == "invalid_argument"
    assert caplog.records[2].gemini_fallback_reason == "invalid_argument"


@pytest.mark.parametrize(
    ("status_code", "provider_status", "message", "expected_class"),
    [
        (400, "INVALID_ARGUMENT", "API key not valid.", "authentication"),
        (429, "RESOURCE_EXHAUSTED", "Quota exhausted.", "quota"),
        (403, "PERMISSION_DENIED", "Permission denied.", "permission"),
        (404, "NOT_FOUND", "Model not found.", "model_unavailable"),
        (500, "INTERNAL", "Provider failed.", "provider_error"),
    ],
)
@pytest.mark.asyncio
async def test_generate_json_never_retries_non_schema_failure(
    caplog,
    status_code: int,
    provider_status: str,
    message: str,
    expected_class: str,
) -> None:
    fake = FakeAsyncClient(httpx.Response(status_code, json={
        "error": {
            "status": provider_status,
            "message": f"{message} provider-secret-key-detail",
        }
    }))

    with caplog.at_level("WARNING", logger="services.gemini"):
        with patch("services.gemini.httpx.AsyncClient", return_value=fake):
            with pytest.raises(GeminiError, match="request failed"):
                await _client().generate_json(
                    "system",
                    "question",
                    {"type": "object"},
                    allow_json_mode_fallback=True,
                )

    assert fake.post.await_count == 1
    assert caplog.records[-1].gemini_error_class == expected_class
    assert "provider-secret" not in caplog.text
    assert "provider-secret" not in repr(caplog.records[-1].__dict__)


@pytest.mark.asyncio
async def test_generate_json_rejects_invalid_json() -> None:
    fake = FakeAsyncClient(_response("not-json"))
    with patch("services.gemini.httpx.AsyncClient", return_value=fake):
        with pytest.raises(GeminiError, match="invalid JSON") as caught:
            await _client().generate_json("system", "question", {"type": "OBJECT"})
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


@pytest.mark.asyncio
async def test_gemini_transport_and_http_errors_are_redacted(caplog) -> None:
    request = httpx.Request("POST", "https://gemini.example")
    fake = FakeAsyncClient(error=httpx.ConnectError("secret network detail", request=request))
    with patch("services.gemini.httpx.AsyncClient", return_value=fake):
        with pytest.raises(GeminiError, match="request failed") as caught:
            await _client().generate_text("system", "user")
    assert "secret network" not in str(caught.value)
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None

    fake = FakeAsyncClient(httpx.Response(429, json={
        "error": {
            "status": "RESOURCE_EXHAUSTED",
            "message": "quota detail containing secret-key",
            "details": [{"reason": "RATE_LIMIT_EXCEEDED"}],
        }
    }))
    with caplog.at_level("WARNING", logger="services.gemini"):
        with patch("services.gemini.httpx.AsyncClient", return_value=fake):
            with pytest.raises(GeminiError, match="request failed") as caught:
                await _client().generate_text("system", "user")
    assert "quota detail" not in str(caught.value)
    assert "secret-key" not in caplog.text
    assert "secret-key" not in repr(caplog.records[-1].__dict__)
    assert caplog.records[-1].gemini_http_status == 429
    assert caplog.records[-1].gemini_error_class == "quota"
    assert caplog.records[-1].gemini_provider_status == "RESOURCE_EXHAUSTED"
    assert caplog.records[-1].gemini_error_reasons == ["RATE_LIMIT_EXCEEDED"]
    assert caplog.records[-1].gemini_request_mode == "text"


@pytest.mark.asyncio
async def test_malformed_success_response_is_redacted_and_fails_safely(caplog) -> None:
    fake = FakeAsyncClient(httpx.Response(
        200,
        text="not-json containing secret model output",
    ))

    with caplog.at_level("WARNING", logger="services.gemini"):
        with patch("services.gemini.httpx.AsyncClient", return_value=fake):
            with pytest.raises(GeminiError, match="Unexpected") as caught:
                await _client().generate_text("system", "user")

    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert "secret model output" not in str(caught.value)
    assert "secret model output" not in caplog.text
    assert "secret model output" not in repr(caplog.records[-1].__dict__)
    assert caplog.records[-1].gemini_error_class == "invalid_response_json"
    assert caplog.records[-1].gemini_http_status == 200


def test_gemini_error_metadata_keeps_only_safe_schema_diagnostics() -> None:
    response = httpx.Response(400, json={
        "error": {
            "status": "INVALID_ARGUMENT",
            "message": "Invalid responseJsonSchema containing private detail",
            "details": [
                {
                    "@type": "type.googleapis.com/google.rpc.BadRequest",
                    "fieldViolations": [
                        {
                            "field": (
                                "generationConfig.responseJsonSchema."
                                "properties.options"
                            ),
                            "description": "private schema description",
                        }
                    ],
                }
            ],
        }
    })

    metadata = _gemini_error_metadata(response)

    assert metadata == {
        "gemini_http_status": 400,
        "gemini_error_class": "schema",
        "gemini_provider_status": "INVALID_ARGUMENT",
        "gemini_error_fields": [
            "generationConfig.responseJsonSchema.properties.options"
        ],
    }
    assert "private" not in repr(metadata)


def test_gemini_error_metadata_classifies_blocked_leaked_key() -> None:
    response = httpx.Response(400, json={
        "error": {
            "status": "INVALID_ARGUMENT",
            "message": (
                "Your API key was reported as leaked. Please use another API key. "
                "provider-secret-detail"
            ),
        }
    })

    metadata = _gemini_error_metadata(response)

    assert metadata == {
        "gemini_http_status": 400,
        "gemini_error_class": "authentication",
        "gemini_provider_status": "INVALID_ARGUMENT",
    }
    assert "provider-secret" not in repr(metadata)


@pytest.mark.parametrize("payload", [
    None,
    {},
    {"candidates": []},
    {"candidates": [None]},
    {"candidates": [{}]},
    {"candidates": [{"content": {}}]},
    {"candidates": [{"content": {"parts": []}}]},
    {"candidates": [{"content": {"parts": [{}]}}]},
    {"candidates": [{"content": {"parts": [{"text": 7}]}}]},
])
def test_extract_text_rejects_every_malformed_shape(payload) -> None:
    with pytest.raises(GeminiError, match="Unexpected"):
        _extract_text(payload)


def test_extract_text_skips_thought_and_metadata_only_parts() -> None:
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"thoughtSignature": "opaque"},
                        {"text": "internal", "thought": True},
                        {"text": '{"CT01":427}'},
                    ]
                }
            }
        ]
    }

    assert _extract_text(payload) == '{"CT01":427}'
