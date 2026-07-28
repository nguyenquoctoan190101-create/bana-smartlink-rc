"""Server-side Vietnamese speech synthesis using the configured Gemini key."""

from __future__ import annotations

import asyncio
import base64
from io import BytesIO
import wave
from typing import Any

import httpx

from services.settings import load_settings


_MAX_PCM_BYTES = 8 * 1024 * 1024
_TRANSIENT_STATUSES = {408, 409, 425, 429}


class SpeechSynthesisError(RuntimeError):
    """Raised when the upstream speech service cannot produce safe audio."""


def _extract_pcm(payload: Any) -> bytes:
    if not isinstance(payload, dict):
        raise SpeechSynthesisError("Unexpected speech response")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise SpeechSynthesisError("Unexpected speech response")
    first = candidates[0] if isinstance(candidates[0], dict) else {}
    content = first.get("content") if isinstance(first, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise SpeechSynthesisError("Unexpected speech response")
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline = part.get("inlineData") or part.get("inline_data")
        if not isinstance(inline, dict) or not isinstance(inline.get("data"), str):
            continue
        mime_type = str(inline.get("mimeType") or inline.get("mime_type") or "")
        if "audio" not in mime_type.lower():
            continue
        invalid_audio = False
        try:
            pcm = base64.b64decode(inline["data"], validate=True)
        except (ValueError, TypeError):
            invalid_audio = True
        if invalid_audio:
            raise SpeechSynthesisError("Invalid speech audio") from None
        if not pcm or len(pcm) > _MAX_PCM_BYTES:
            raise SpeechSynthesisError("Invalid speech audio")
        return pcm
    raise SpeechSynthesisError("Unexpected speech response")


def _pcm_to_wav(pcm: bytes) -> bytes:
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24000)
        wav_file.writeframes(pcm)
    return output.getvalue()


async def synthesize_vietnamese_speech(text: str) -> bytes:
    """Generate a short WAV response without persisting text or audio."""

    settings = load_settings()
    if not settings.gemini_api_key:
        raise SpeechSynthesisError("Speech provider is not configured")
    model = settings.gemini_tts_model.strip() or "gemini-2.5-flash-preview-tts"
    voice = settings.gemini_tts_voice.strip() or "Kore"
    prompt = (
        "Synthesize speech. Read only the transcript below, without reading these "
        "instructions. Use clear natural Vietnamese, a calm professional female "
        "public-service voice, medium-slow pace, and a gentle Central Vietnam / "
        "Da Nang accent when possible.\n\n"
        "### TRANSCRIPT\n"
        f"{text}"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice},
                }
            },
        },
    }
    url = (
        f"{settings.gemini_api_url.rstrip('/')}/v1beta/models/"
        f"{model}:generateContent"
    )
    timeout = httpx.Timeout(connect=10.0, read=50.0, write=15.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(2):
            transport_failed = False
            try:
                response = await client.post(
                    url,
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json=payload,
                )
            except httpx.HTTPError:
                if attempt == 0:
                    await asyncio.sleep(0.5)
                    continue
                transport_failed = True
            if transport_failed:
                raise SpeechSynthesisError("Speech provider request failed") from None
            if response.status_code >= 400:
                if (
                    attempt == 0
                    and (
                        response.status_code in _TRANSIENT_STATUSES
                        or response.status_code >= 500
                    )
                ):
                    await asyncio.sleep(0.5)
                    continue
                raise SpeechSynthesisError("Speech provider request failed")
            invalid_audio = False
            try:
                return _pcm_to_wav(_extract_pcm(response.json()))
            except (ValueError, SpeechSynthesisError):
                if attempt == 0:
                    await asyncio.sleep(0.5)
                    continue
                invalid_audio = True
            if invalid_audio:
                raise SpeechSynthesisError(
                    "Speech provider returned invalid audio"
                ) from None
    raise SpeechSynthesisError("Speech provider request failed")


__all__ = ["SpeechSynthesisError", "synthesize_vietnamese_speech"]
