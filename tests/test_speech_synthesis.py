from __future__ import annotations

import base64
from unittest.mock import AsyncMock

import httpx
import pytest

from services import speech_synthesis, speech_token
from services.settings import Settings


class _FakeSpeechClient:
    def __init__(self, responses: list[httpx.Response | Exception]) -> None:
        self.post = AsyncMock(side_effect=responses)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        feature_voice=True,
        gemini_api_key="speech-test-key",
        gemini_api_url="https://gemini.example",
        gemini_tts_model="gemini-2.5-flash-preview-tts",
        gemini_tts_voice="Kore",
        extraction_review_signing_key="test-signing-key-with-enough-entropy",
    )


def test_speech_token_is_short_lived_bound_and_blocks_sensitive_text(
    monkeypatch,
) -> None:
    monkeypatch.setattr(speech_token, "load_settings", _settings)
    token = speech_token.issue_speech_token(
        text="Thôn An Sơn có 427 hộ dân.",
        subject="public",
        now=1000,
    )

    assert token is not None
    assert speech_token.verify_speech_token(
        token,
        subject="public",
        now=1100,
    ) == "Thôn An Sơn có 427 hộ dân."
    with pytest.raises(speech_token.SpeechTokenError):
        speech_token.verify_speech_token(
            token,
            subject="another-user",
            now=1100,
        )
    with pytest.raises(speech_token.SpeechTokenError):
        speech_token.verify_speech_token(
            token,
            subject="public",
            now=1400,
        )
    assert speech_token.issue_speech_token(
        text="CT14 là số vụ bạo lực gia đình.",
        subject="public",
        now=1000,
    ) is None


@pytest.mark.asyncio
async def test_server_tts_returns_wav_and_requests_vietnamese_style(
    monkeypatch,
) -> None:
    pcm = b"\x00\x00" * 240
    fake = _FakeSpeechClient([
        httpx.Response(
            200,
            json={
                "candidates": [{
                    "content": {
                        "parts": [{
                            "inlineData": {
                                "mimeType": "audio/L16;codec=pcm;rate=24000",
                                "data": base64.b64encode(pcm).decode("ascii"),
                            }
                        }]
                    }
                }]
            },
        )
    ])
    monkeypatch.setattr(speech_synthesis, "load_settings", _settings)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake)

    audio = await speech_synthesis.synthesize_vietnamese_speech(
        "Thôn An Sơn có 427 hộ dân."
    )

    assert audio.startswith(b"RIFF")
    assert b"WAVE" in audio[:16]
    request = fake.post.await_args
    assert request.args[0].endswith(
        "/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"
    )
    assert request.kwargs["headers"] == {"x-goog-api-key": "speech-test-key"}
    payload = request.kwargs["json"]
    assert payload["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert (
        payload["generationConfig"]["speechConfig"]["voiceConfig"]
        ["prebuiltVoiceConfig"]["voiceName"]
        == "Kore"
    )
    assert "Central Vietnam" in payload["contents"][0]["parts"][0]["text"]


@pytest.mark.asyncio
async def test_server_tts_retries_one_transient_invalid_response(
    monkeypatch,
) -> None:
    pcm = b"\x00\x00" * 32
    fake = _FakeSpeechClient([
        httpx.Response(500, json={"error": {"message": "temporary"}}),
        httpx.Response(
            200,
            json={
                "candidates": [{
                    "content": {
                        "parts": [{
                            "inlineData": {
                                "mimeType": "audio/L16;rate=24000",
                                "data": base64.b64encode(pcm).decode("ascii"),
                            }
                        }]
                    }
                }]
            },
        ),
    ])
    monkeypatch.setattr(speech_synthesis, "load_settings", _settings)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake)
    sleep = AsyncMock()
    monkeypatch.setattr(speech_synthesis.asyncio, "sleep", sleep)

    audio = await speech_synthesis.synthesize_vietnamese_speech("Xin chào.")

    assert audio.startswith(b"RIFF")
    assert fake.post.await_count == 2
    sleep.assert_awaited_once_with(0.5)


@pytest.mark.asyncio
async def test_server_tts_transport_error_drops_request_and_response_secrets(
    monkeypatch,
) -> None:
    def _provider_error(suffix: str) -> httpx.HTTPStatusError:
        request = httpx.Request(
            "POST",
            "https://gemini.example/generateContent",
            headers={"x-goog-api-key": f"provider-secret-key-{suffix}"},
        )
        response = httpx.Response(
            502,
            content=f"provider-secret-body-{suffix}".encode(),
            request=request,
        )
        return httpx.HTTPStatusError(
            f"provider-secret-transport-{suffix}",
            request=request,
            response=response,
        )

    fake = _FakeSpeechClient([_provider_error("one"), _provider_error("two")])
    monkeypatch.setattr(speech_synthesis, "load_settings", _settings)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake)
    monkeypatch.setattr(speech_synthesis.asyncio, "sleep", AsyncMock())

    with pytest.raises(
        speech_synthesis.SpeechSynthesisError,
        match="request failed",
    ) as caught:
        await speech_synthesis.synthesize_vietnamese_speech("Xin chào.")

    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert "provider-secret" not in str(caught.value)


@pytest.mark.asyncio
async def test_server_tts_malformed_json_does_not_retain_provider_body(
    monkeypatch,
) -> None:
    fake = _FakeSpeechClient([
        httpx.Response(200, content=b"provider-secret-malformed-body-one"),
        httpx.Response(200, content=b"provider-secret-malformed-body-two"),
    ])
    monkeypatch.setattr(speech_synthesis, "load_settings", _settings)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake)
    monkeypatch.setattr(speech_synthesis.asyncio, "sleep", AsyncMock())

    with pytest.raises(
        speech_synthesis.SpeechSynthesisError,
        match="invalid audio",
    ) as caught:
        await speech_synthesis.synthesize_vietnamese_speech("Xin chào.")

    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert "provider-secret" not in str(caught.value)
