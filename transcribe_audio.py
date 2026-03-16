"""Async audio transcription via ElevenLabs Scribe v2 API.

Requires: ELEVENLABS_API_KEY environment variable.

Usage:
    from transcribe_audio import transcribe_audio

    result = await transcribe_audio(audio_bytes, media_type="audio/mpeg")
    print(result["text"])

    result = await transcribe_audio(audio_bytes, media_type="audio/mpeg", timestamps="word")
    for word in result["words"]:
        print(f"{word['text']} ({word['start']}-{word['end']})")
"""

import os
import httpx


ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/speech-to-text"


def _get_api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key:
        raise RuntimeError(
            "ELEVENLABS_API_KEY environment variable is not set. "
            "Get a key at https://elevenlabs.io/app/settings/api-keys"
        )
    return key


def _ext_for_media_type(media_type: str) -> str:
    mapping = {
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/mp4": "m4a",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
        "audio/webm": "webm",
    }
    return mapping.get(media_type, "wav")


async def transcribe_audio(
    audio_bytes: bytes,
    *,
    media_type: str = "audio/mpeg",
    timestamps: str = "word",
    diarize: bool = False,
    num_speakers: int | None = None,
    language: str | None = None,
    model: str = "scribe_v2",
) -> dict:
    """Transcribe audio using ElevenLabs Scribe v2 REST API.
    
    Returns dict with keys: text, language_code, words
    Each word has: text, start, end, speaker_id
    """
    api_key = _get_api_key()
    ext = _ext_for_media_type(media_type)
    filename = f"audio.{ext}"

    # Build multipart form data
    form_data = {
        "model_id": model,
        "timestamps_granularity": timestamps,
        "diarize": str(diarize).lower(),
        "tag_audio_events": "false",
    }

    if num_speakers is not None:
        form_data["num_speakers"] = str(num_speakers)
    if language:
        form_data["language_code"] = language

    files = {
        "file": (filename, audio_bytes, media_type),
    }

    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post(
            ELEVENLABS_API_URL,
            headers={"xi-api-key": api_key},
            data=form_data,
            files=files,
        )

    if response.status_code != 200:
        error_detail = response.text[:500]
        raise RuntimeError(
            f"ElevenLabs API error ({response.status_code}): {error_detail}"
        )

    result = response.json()

    # Extract text and words from the response
    full_text = result.get("text", "")
    language_code = result.get("language_code", "en")
    raw_words = result.get("words", [])

    # Filter to actual words only (skip spacing, punctuation markers)
    words = []
    for w in raw_words:
        word_type = w.get("type", "word")
        if word_type != "word":
            continue
        words.append({
            "text": w.get("text", ""),
            "start": w.get("start", 0),
            "end": w.get("end", 0),
            "speaker_id": w.get("speaker_id", None),
        })

    return {
        "text": full_text,
        "language_code": language_code,
        "words": words,
    }
