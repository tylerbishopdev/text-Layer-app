---
name: karaoke-publish
description: End-to-end karaoke workflow — take a local video or audio file (or an open.video URL), generate a synced karaoke video via the textlayer.app MCP, then upload the rendered MP4 to open.video via the open.video MCP with an SEO-optimized title, description, and tags. Trigger on requests like "make a karaoke video and post it", "turn this song into karaoke and upload to open.video", "publish a karaoke version of <file>", or any combination of textlayer + open.video in one workflow.
---

# Karaoke → open.video publishing workflow

This skill chains two MCP servers to go from a raw audio/video file to a published karaoke video:

1. **textlayer.app MCP** (this repo's `mcp-server/index.ts`) — transcribes with word-level timestamps and renders a synced karaoke MP4.
2. **open.video MCP** — uploads the finished MP4 with title/description/tags.

You are the orchestrator. Do not ask the user to run anything manually that a tool can do.

## Before you start

1. Confirm both MCP servers are reachable. Call a cheap tool on each — e.g. `textlayer`'s `health_check`, and whichever list/me-type tool the open.video MCP exposes. If either is missing, stop and tell the user how to add it:
   - textlayer: `claude mcp add karaoke -- npx tsx mcp-server/index.ts` (run from this repo, with the Express app running on port 5000, or set `KARAOKE_API_BASE` to a remote deployment).
   - open.video: whatever command the user installed it with. If it's simply not registered, say so.
2. **Discover the open.video MCP's tool names at runtime** — do not assume. List the tools it exposes (e.g. by asking "what tools does the open.video MCP offer?" or by trying a list/help tool) and pick the ones that correspond to: upload a video file, set/update metadata, and (optionally) publish/make public. Tool names vary.
3. Confirm the exact tool names to yourself before calling them. If ambiguous, ask the user.

## Input handling

You will be given one of:

- **A local audio file** (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.opus`, `.webm`, `.flac`). Go straight to step 2.
- **A local video file** (`.mp4`, `.mov`, `.mkv`, `.webm`, etc.). Extract the audio first:

  ```bash
  ffmpeg -y -i "<video>" -vn -acodec libmp3lame -q:a 2 "<tmp>/<basename>.mp3"
  ```

  Use the resulting `.mp3` for the textlayer upload. Keep the original video path — you may want its filename for metadata hints.
- **An open.video URL** (or any URL yt-dlp can fetch). Skip extraction and go straight to `create_job_from_url`.
- **Multiple files** — run the workflow per file, sequentially. Do not parallelize uploads to open.video unless the user asks.

Resolve every path to an absolute path before passing it to MCP tools.

## Step 1 — Generate the karaoke video (textlayer MCP)

Use the textlayer MCP tools:

- URL input → `create_job_from_url({ url })`
- Local audio input → `upload_audio_file({ path: "<absolute path>" })`

Both return a `jobId`. Then:

- `wait_for_job({ jobId, timeoutSeconds: 900 })` — block until `complete` or `error`. Pick a timeout generous enough for long songs; the default 600s is fine for <5 min songs.
- If status is `error`, surface the `statusMessage`/`error` fields to the user and stop. Do not retry blindly.
- On `complete`, call `get_job({ jobId, includeTranscription: true })` so you have the lyrics text and word timings available for metadata (step 3).
- `download_video({ jobId, outputPath: "<absolute path to a .mp4>", overwrite: true })` to pull the rendered MP4 to disk. Pick an output path under `/tmp/` or the user's working directory — do not clutter the repo.

## Step 2 — Derive optimized metadata

Before uploading, build:

- **Title** (target ~60 chars, hard cap 100):
  - If the user provided a title, respect it but polish it.
  - Otherwise, derive from the source filename and/or the first bar of the transcription. Always suffix ` (Karaoke)` or ` [Karaoke Version]` so searchers find it.
  - Include the artist if obvious from the filename (e.g. `Artist - Song.mp3` → `Artist – Song (Karaoke)`).
  - No clickbait, no ALL CAPS, no emoji unless the user asked.
- **Description** (2–4 short paragraphs):
  - Sentence 1: "Karaoke version of <song> by <artist>, with synced word-level lyrics."
  - Sentence 2: how it was made ("Auto-transcribed by ElevenLabs Scribe v2 and rendered with textlayer.app.").
  - Paragraph 2 (optional): the first few lines of the lyrics from `transcription.text`, so the description is searchable. Respect any copyright concerns — include a short excerpt, not the full lyric.
  - Paragraph 3 (optional): credits / source URL if the user supplied one.
- **Tags** (5–12 items, lowercase, no `#`):
  - Always include: `karaoke`, `karaoke-version`, `lyrics`, `sing-along`.
  - Plus artist, song title, genre (if known), language (from `transcription.language_code`), year (if known).
- **Language**: prefer `transcription.language_code` if the open.video MCP accepts it.
- **Thumbnail**: only attach one if the user provided it or if the open.video tool requires it — don't invent assets.
- **Visibility**: default to `unlisted` or the MCP's equivalent of "needs user confirmation before public" unless the user explicitly said "publish" or "public". Always show the user the metadata and ask for confirmation before flipping to public.

Before calling the upload tool, print the proposed title/description/tags to the user and confirm — unless they said "just do it" / "no need to confirm".

## Step 3 — Upload to open.video

Call the open.video MCP's upload tool with:

- The absolute path of the downloaded `.mp4`.
- The title, description, tags, language, and visibility from step 2.
- Whatever required fields the tool's schema demands — read the schema, don't guess.

If the upload tool streams progress or returns a job id, poll/await it the same way you did for textlayer. On success, surface the resulting URL to the user.

If the MCP separates "create draft" from "publish", use that separation: create the draft, report the draft URL, and only publish after the user confirms (unless they pre-authorized).

## Step 4 — Report back

End with a single concise summary:

- Source file(s) processed.
- Karaoke job id(s) and local MP4 path(s).
- open.video URL(s) (draft or public).
- Any warnings (e.g. "short transcription — lyrics may be incomplete", "language detected as X but you said Y").

## Failure modes to watch for

- **No vocals detected**: textlayer errors with "No lyrics detected". Tell the user the source must contain clear vocals; don't retry.
- **Timeout during rendering**: raise `timeoutSeconds` or ask the user whether to keep waiting via another `wait_for_job` call.
- **open.video rejects the upload**: surface the exact error. Common causes: file too large, missing required metadata, auth expired. Do not silently retry auth-related failures.
- **Both MCPs connected but the textlayer Express app is down**: `health_check` will return a non-ok status. Tell the user to start the server (`npm run dev` from this repo) or set `KARAOKE_API_BASE`.
- **Ambiguous tool names on open.video MCP**: ask the user rather than guessing. Getting the upload target wrong is not a silently-recoverable mistake.

## Don't

- Don't fabricate lyrics, artist names, or album info to pad metadata. If you don't know it, omit it.
- Don't publish public without explicit user authorization.
- Don't delete the original source file.
- Don't run the ffmpeg step if the input is already audio — it wastes time and re-encodes.
- Don't call the open.video upload tool until you have the rendered `.mp4` on disk locally.
