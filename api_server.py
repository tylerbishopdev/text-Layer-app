#!/usr/bin/env python3
"""
Karaoke Video Generator - Python API Server
Handles: audio extraction (yt-dlp), transcription (LLM API), video rendering (ffmpeg)
"""

import asyncio
import base64
import json
import os
import re
import subprocess
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from transcribe_audio import transcribe_audio

app = FastAPI()

# Font path: try multiple locations for cross-platform compat
def _find_font():
    candidates = [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",  # Debian/Ubuntu
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",          # Debian fallback
        "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",              # Perplexity sandbox
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",            # FreeFonts
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return "Arial"  # fallback to ffmpeg built-in name

FONT_PATH = _find_font()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WORK_DIR = Path("/tmp/karaoke_jobs")
WORK_DIR.mkdir(exist_ok=True)

OUTPUT_DIR = Path("/tmp/karaoke_output")
OUTPUT_DIR.mkdir(exist_ok=True)


class ExtractRequest(BaseModel):
    url: str
    job_id: str


class TranscribeRequest(BaseModel):
    audio_path: str
    job_id: str


class RenderRequest(BaseModel):
    audio_path: str
    transcription: dict
    job_id: str
    title: str = "Karaoke"


@app.post("/api/extract-audio")
async def extract_audio(req: ExtractRequest):
    """Extract audio from an open.video URL using yt-dlp"""
    job_dir = WORK_DIR / req.job_id
    job_dir.mkdir(exist_ok=True)
    audio_path = str(job_dir / "audio.wav")

    try:
        # Use yt-dlp to extract audio
        result = subprocess.run(
            [
                "yt-dlp",
                "--no-check-certificates",
                "-x",
                "--audio-format", "wav",
                "--audio-quality", "0",
                "-o", str(job_dir / "audio.%(ext)s"),
                "--no-playlist",
                req.url,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            # Try ffmpeg direct approach for HLS streams
            # First try to get the m3u8 URL from the page
            try:
                page_result = subprocess.run(
                    ["yt-dlp", "--no-check-certificates", "-g", req.url],
                    capture_output=True, text=True, timeout=30,
                )
                stream_url = page_result.stdout.strip()
                if not stream_url:
                    raise Exception("Could not get stream URL")
            except:
                # Fallback: try constructing the HLS URL pattern
                stream_url = req.url

            ffmpeg_result = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", stream_url,
                    "-vn",
                    "-acodec", "pcm_s16le",
                    "-ar", "44100",
                    "-ac", "2",
                    audio_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if ffmpeg_result.returncode != 0:
                raise Exception(f"yt-dlp error: {result.stderr}\nffmpeg error: {ffmpeg_result.stderr}")

        # Find the actual output file (yt-dlp may use different extension)
        actual_path = audio_path
        if not os.path.exists(audio_path):
            for f in job_dir.iterdir():
                if f.suffix in ('.wav', '.mp3', '.m4a', '.ogg', '.opus', '.webm'):
                    # Convert to wav if not already
                    if f.suffix != '.wav':
                        subprocess.run(
                            ["ffmpeg", "-y", "-i", str(f), "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", audio_path],
                            capture_output=True, timeout=60,
                        )
                        actual_path = audio_path
                    else:
                        actual_path = str(f)
                    break

        if not os.path.exists(actual_path):
            raise Exception("No audio file produced")

        # Get title from yt-dlp
        title = "Karaoke"
        try:
            title_result = subprocess.run(
                ["yt-dlp", "--no-check-certificates", "--get-title", req.url],
                capture_output=True, text=True, timeout=15,
            )
            if title_result.returncode == 0 and title_result.stdout.strip():
                title = title_result.stdout.strip()
        except:
            pass

        return {"audio_path": actual_path, "title": title}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=422, detail="Audio extraction timed out")
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/upload-audio")
async def upload_audio(file: UploadFile = File(...), job_id: str = Form(...)):
    """Handle uploaded audio file"""
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(exist_ok=True)

    # Save the uploaded file
    upload_path = job_dir / f"upload{Path(file.filename or 'audio.wav').suffix}"
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)

    # Convert to wav for consistent processing
    audio_path = str(job_dir / "audio.wav")
    if upload_path.suffix.lower() != ".wav":
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(upload_path), "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", audio_path],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=422, detail=f"Failed to convert audio: {result.stderr}")
    else:
        audio_path = str(upload_path)

    return {"audio_path": audio_path, "title": Path(file.filename or "audio").stem}


@app.post("/api/transcribe")
async def transcribe(req: TranscribeRequest):
    """Transcribe audio with word-level timestamps"""
    try:
        with open(req.audio_path, "rb") as f:
            audio_bytes = f.read()

        # Determine media type
        media_type = "audio/wav"
        if req.audio_path.endswith(".mp3"):
            media_type = "audio/mpeg"
        elif req.audio_path.endswith(".m4a"):
            media_type = "audio/mp4"

        result = await transcribe_audio(
            audio_bytes,
            media_type=media_type,
            timestamps="word",
            diarize=False,
        )

        return result

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=422, detail=str(e))


def group_words_into_lines(words, max_words_per_line=7, max_duration=4.0):
    """Group words into display lines for karaoke"""
    lines = []
    current_line = []

    for word in words:
        current_line.append(word)

        # Check if line should break
        should_break = False
        if len(current_line) >= max_words_per_line:
            should_break = True
        elif current_line and (word["end"] - current_line[0]["start"]) > max_duration:
            should_break = True

        if should_break and current_line:
            lines.append(current_line)
            current_line = []

    if current_line:
        lines.append(current_line)

    return lines


def generate_ass_subtitle(words, title="Karaoke"):
    """Generate ASS subtitle file with karaoke highlighting effect"""
    lines = group_words_into_lines(words)

    ass_content = """[Script Info]
Title: {title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyrics,Liberation Sans,78,&H00FFFFFF,&H00FFCC00,&H00000000,&HC0000000,-1,0,0,0,100,100,2,0,1,5,3,5,60,60,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""".format(title=title)

    def format_time(seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    for i, line_words in enumerate(lines):
        if not line_words:
            continue

        line_start = line_words[0]["start"]
        line_end = line_words[-1]["end"]

        # Add small padding
        display_start = max(0, line_start - 0.1)
        display_end = line_end + 0.5

        start_str = format_time(display_start)
        end_str = format_time(display_end)

        # Build karaoke text with \k tags (centisecond durations)
        kara_parts = []
        for j, w in enumerate(line_words):
            word_text = w["text"].strip()
            if not word_text:
                continue

            # Duration in centiseconds for this word
            dur_cs = max(1, int((w["end"] - w["start"]) * 100))

            # Add space before word (except first)
            if j > 0:
                kara_parts.append(f"{{\\kf{dur_cs}}}{word_text} ")
            else:
                kara_parts.append(f"{{\\kf{dur_cs}}}{word_text} ")

        kara_text = "".join(kara_parts).strip()

        ass_content += f"Dialogue: 0,{start_str},{end_str},Lyrics,,0,0,0,,{kara_text}\n"

    return ass_content


@app.post("/api/render")
async def render_video(req: RenderRequest):
    """Render karaoke video with lyrics overlay"""
    try:
        job_dir = WORK_DIR / req.job_id
        job_dir.mkdir(exist_ok=True)
        output_path = str(OUTPUT_DIR / f"{req.job_id}.mp4")

        words = req.transcription.get("words", [])
        if not words:
            raise HTTPException(status_code=422, detail="No words in transcription")

        # Get audio duration
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", req.audio_path],
            capture_output=True, text=True, timeout=15,
        )
        duration = float(probe.stdout.strip()) if probe.stdout.strip() else 180.0

        # Generate ASS subtitle file
        ass_content = generate_ass_subtitle(words, req.title)
        ass_path = str(job_dir / "lyrics.ass")
        with open(ass_path, "w") as f:
            f.write(ass_content)

        # Build karaoke video with ffmpeg
        # Dark gradient background + ASS subtitle overlay
        filter_complex = (
            f"color=c=#0a0a1a:s=1920x1080:d={duration},"
            f"drawtext=text='{_escape_ffmpeg_text(req.title)}'"
            f":fontfile={FONT_PATH}"
            f":fontsize=42:fontcolor=white@0.6:x=(w-text_w)/2:y=60,"
            f"ass='{ass_path}'"
            f"[v]"
        )

        # Create a nice gradient background using gradients filter
        bg_filter = (
            f"color=c=#0c0820:s=1920x1080:d={duration},format=yuv420p,"
            f"drawbox=x=0:y=0:w=1920:h=400:color=#12062e@0.6:t=fill,"
            f"drawbox=x=0:y=680:w=1920:h=400:color=#061a2e@0.4:t=fill"
        )

        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", bg_filter,
            "-i", req.audio_path,
            "-filter_complex",
            f"[0:v]drawtext=text='{_escape_ffmpeg_text(req.title)}'"
            f":fontfile={FONT_PATH}"
            f":fontsize=38:fontcolor=white@0.5:x=(w-text_w)/2:y=40,"
            f"ass='{ass_path}'[v]",
            "-map", "[v]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-pix_fmt", "yuv420p",
            "-shortest",
            output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            # Fallback: try without ASS, use drawtext with word-at-a-time approach
            return await render_video_drawtext(req, words, duration, output_path, job_dir)

        if not os.path.exists(output_path):
            raise Exception("No video file produced")

        return {"video_path": output_path, "video_url": f"/api/video/{req.job_id}"}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=422, detail="Video rendering timed out")
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=422, detail=str(e))


async def render_video_drawtext(req, words, duration, output_path, job_dir):
    """Fallback renderer using drawtext filters for karaoke effect"""
    lines = group_words_into_lines(words)

    # Build a complex filter with drawtext for each line
    # We'll show each line of text and highlight words as they're sung
    drawtext_filters = []

    # Title
    drawtext_filters.append(
        f"drawtext=text='{_escape_ffmpeg_text(req.title)}'"
        f":fontfile={FONT_PATH}"
        f":fontsize=42:fontcolor=white@0.6:x=(w-text_w)/2:y=60"
    )

    for i, line_words in enumerate(lines):
        if not line_words:
            continue

        line_start = line_words[0]["start"]
        line_end = line_words[-1]["end"]
        full_text = " ".join(w["text"].strip() for w in line_words if w["text"].strip())

        if not full_text:
            continue

        # Show the unhighlighted line
        drawtext_filters.append(
            f"drawtext=text='{_escape_ffmpeg_text(full_text)}'"
            f":fontfile={FONT_PATH}"
            f":fontsize=64:fontcolor=white@0.8:x=(w-text_w)/2:y=(h/2)"
            f":enable='between(t,{max(0, line_start - 0.2):.3f},{line_end + 0.5:.3f})'"
            f":shadowcolor=black@0.8:shadowx=3:shadowy=3"
        )

        # Add highlighted words on top
        for j, w in enumerate(line_words):
            word_text = w["text"].strip()
            if not word_text:
                continue

            # Calculate x position for this word within the line
            prefix = " ".join(ww["text"].strip() for ww in line_words[:j] if ww["text"].strip())
            prefix_with_space = prefix + " " if prefix else ""

            drawtext_filters.append(
                f"drawtext=text='{_escape_ffmpeg_text(word_text)}'"
                f":fontfile={FONT_PATH}"
                f":fontsize=68:fontcolor=#00CCFF:x=(w-tw)/2+{_calc_offset(prefix_with_space)}"
                f":y=(h/2)-2"
                f":enable='between(t,{w['start']:.3f},{w['end']:.3f})'"
                f":shadowcolor=#0066AA@0.6:shadowx=2:shadowy=2"
            )

    # Build the final ffmpeg command
    filter_chain = ",".join(drawtext_filters)

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=#0a0a1a:s=1920x1080:d={duration},format=yuv420p",
        "-i", req.audio_path,
        "-filter_complex", f"[0:v]{filter_chain}[v]",
        "-map", "[v]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-shortest",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise Exception(f"FFmpeg error: {result.stderr[-500:]}")

    return {"video_path": output_path, "video_url": f"/api/video/{req.job_id}"}


def _escape_ffmpeg_text(text):
    """Escape text for ffmpeg drawtext filter"""
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "\u2019")  # smart quote
    text = text.replace(":", "\\:")
    text = text.replace("%", "%%")
    text = text.replace("[", "\\[")
    text = text.replace("]", "\\]")
    text = text.replace(";", "\\;")
    return text


def _calc_offset(prefix):
    """Rough pixel offset estimate for text positioning"""
    # Approximate: 30px per character at fontsize 64
    return int(len(prefix) * 28)


@app.get("/api/video/{job_id}")
async def get_video(job_id: str):
    """Serve the rendered video"""
    video_path = OUTPUT_DIR / f"{job_id}.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        str(video_path),
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="karaoke_{job_id}.mp4"'},
    )


@app.get("/api/video/{job_id}/stream")
async def stream_video(job_id: str):
    """Stream the rendered video for preview"""
    video_path = OUTPUT_DIR / f"{job_id}.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(video_path), media_type="video/mp4")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
