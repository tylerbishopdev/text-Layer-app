# Karaoke Video Generator

Paste an open.video link or upload audio (.wav/.mp3). The app transcribes lyrics with word-level timestamps and renders a synced karaoke video with highlighted lyrics.

## Architecture

- **Express** (port 5000) — Serves React SPA + API routes, orchestrates job pipeline
- **FastAPI** (port 8000) — Heavy processing: yt-dlp downloads, transcription via ElevenLabs Scribe v2, ffmpeg video rendering

## Prerequisites

- [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) (free tier works for short audio)

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [Railway](https://railway.app) → New Project → Deploy from GitHub Repo
3. Select your repo — Railway auto-detects the Dockerfile
4. Add environment variable:
   - `ELEVENLABS_API_KEY` = your ElevenLabs API key
5. Deploy — Railway will build the Docker image and start the app

Railway automatically sets the `PORT` env variable. The app reads it from `process.env.PORT`.

## Deploy with Docker (self-hosted)

```bash
docker build -t karaoke-gen .

docker run -d \
  -p 5000:5000 \
  -e ELEVENLABS_API_KEY=your_key_here \
  --name karaoke-gen \
  karaoke-gen
```

Then open `http://localhost:5000`.

## Local Development

```bash
# Install Node dependencies
npm install

# Install Python dependencies  
pip install fastapi uvicorn[standard] httpx python-multipart

# Set your API key
export ELEVENLABS_API_KEY=your_key_here

# Start Python API server (in one terminal)
python3 -m uvicorn api_server:app --host 0.0.0.0 --port 8000

# Start Node dev server (in another terminal)
npm run dev
```

Open `http://localhost:5000`.

## How It Works

1. **Audio extraction** — yt-dlp pulls audio from open.video URLs, or you upload .wav/.mp3 directly
2. **Transcription** — ElevenLabs Scribe v2 generates word-level timestamps
3. **Subtitle generation** — ASS subtitles with `\kf` karaoke fill tags for word-by-word highlighting
4. **Video rendering** — ffmpeg composites dark gradient background + title + synced lyrics overlay
5. **Preview & download** — Stream or download the final .mp4

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ELEVENLABS_API_KEY` | Yes | ElevenLabs API key for transcription |
| `PORT` | No | Server port (default: 5000, Railway sets automatically) |
| `KARAOKE_API_BASE` | No | MCP server only — URL of the running Express app (default: `http://127.0.0.1:5000`) |

## Headless access (REST API + MCP server)

You can drive the whole pipeline without opening the web UI.

### REST API

The Express app on port 5000 already exposes everything the SPA uses:

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/jobs/url` | `{ "url": "..." }` | Start a job from a URL |
| `POST` | `/api/jobs/upload` | `multipart/form-data` field `audio` | Start a job from an uploaded audio file |
| `GET`  | `/api/jobs/:id` | — | Job status, progress, transcription, video URL |
| `GET`  | `/api/jobs` | — | All jobs, newest first |
| `GET`  | `/api/video/:id/stream` | — | Stream the rendered MP4 |
| `GET`  | `/api/video/:id/download` | — | Download the rendered MP4 |
| `GET`  | `/api/health` | — | Liveness check |

### MCP server

`mcp-server/index.ts` is a stdio MCP server that wraps the REST API so Claude Code (or any MCP client) can submit jobs, poll status, and pull down the rendered video without using a browser.

Add it to Claude Code:

```bash
# from the repo root, with the Express app running on :5000
claude mcp add karaoke -- npx tsx mcp-server/index.ts
```

Or, to point at a remote deployment:

```bash
claude mcp add karaoke --env KARAOKE_API_BASE=https://your-app.up.railway.app -- npx tsx mcp-server/index.ts
```

Tools exposed:

| Tool | Purpose |
|---|---|
| `health_check` | Verify the API is reachable |
| `create_job_from_url` | Submit a URL and get a job id |
| `upload_audio_file` | Upload a local audio file by absolute path |
| `get_job` | Fetch status / progress / transcription for one job |
| `list_jobs` | List all jobs, newest first |
| `wait_for_job` | Block until a job hits `complete` or `error` |
| `get_transcription` | Return the word-level transcription |
| `download_video` | Save the rendered MP4 to a local path |

You can also run it standalone (e.g. for inspector tooling):

```bash
npm run mcp
```
