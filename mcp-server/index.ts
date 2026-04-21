#!/usr/bin/env tsx
/**
 * MCP server for the Karaoke Video Generator.
 *
 * Exposes the running Express app (default http://127.0.0.1:5000) as MCP tools so
 * Claude Code (or any MCP client) can submit URLs / audio files, poll job status,
 * fetch transcriptions, and download rendered videos without using a browser.
 *
 * Configure in Claude Code with:
 *   claude mcp add karaoke -- npx tsx mcp-server/index.ts
 * or pass KARAOKE_API_BASE to point at a remote deployment.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { KaraokeJob } from "../shared/schema";

const API_BASE = (process.env.KARAOKE_API_BASE || "http://127.0.0.1:5000").replace(/\/+$/, "");

type JsonOk<T> = { ok: true; data: T };
type JsonErr = { ok: false; status: number; error: string };

async function apiJson<T>(path: string, init?: RequestInit): Promise<JsonOk<T> | JsonErr> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e: any) {
    return { ok: false, status: 0, error: `Failed to reach ${API_BASE}${path}: ${e.message}` };
  }
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: res.status, error: `Invalid JSON from ${path}: ${text.slice(0, 200)}` };
  }
}

function textResult(payload: unknown) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text: body }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function summarizeJob(job: KaraokeJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    statusMessage: job.statusMessage,
    sourceType: job.sourceType,
    sourceUrl: job.sourceUrl,
    fileName: job.fileName,
    title: job.title,
    error: job.error,
    hasTranscription: Boolean(job.transcription),
    videoUrl: job.videoUrl ? `${API_BASE}/api/video/${job.id}/stream` : undefined,
    downloadUrl: job.videoUrl ? `${API_BASE}/api/video/${job.id}/download` : undefined,
    createdAt: job.createdAt,
  };
}

function resolveLocalPath(input: string): string {
  if (input.startsWith("file://")) return fileURLToPath(input);
  return path.resolve(input);
}

const server = new McpServer({
  name: "karaoke-generator",
  version: "0.1.0",
});

server.registerTool(
  "health_check",
  {
    title: "Health check",
    description: `Pings the karaoke service at ${API_BASE}/api/health to confirm the Express + Python pipeline is reachable.`,
    inputSchema: {},
  },
  async () => {
    const res = await apiJson<{ status: string; service: string }>("/api/health");
    if (!res.ok) return errorResult(`Service unhealthy (status ${res.status}): ${res.error}`);
    return textResult({ apiBase: API_BASE, ...res.data });
  }
);

server.registerTool(
  "create_job_from_url",
  {
    title: "Create karaoke job from URL",
    description:
      "Submits a URL (e.g. an open.video link) to the karaoke pipeline. Returns the new job id; the job runs asynchronously — poll with `get_job` or block with `wait_for_job`.",
    inputSchema: {
      url: z.string().url().describe("Source URL to extract audio from"),
    },
  },
  async ({ url }) => {
    const res = await apiJson<KaraokeJob>("/api/jobs/url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return errorResult(`Failed to create job (status ${res.status}): ${res.error}`);
    return textResult(summarizeJob(res.data));
  }
);

server.registerTool(
  "upload_audio_file",
  {
    title: "Upload local audio file",
    description:
      "Uploads a local audio file (.wav, .mp3, .m4a, .ogg, .opus, .webm, .flac) to start a karaoke job. Provide an absolute path or file:// URL on the machine running this MCP server.",
    inputSchema: {
      path: z.string().describe("Absolute path (or file:// URL) of the audio file to upload"),
      filename: z.string().optional().describe("Override the upstream filename (defaults to basename of path)"),
    },
  },
  async ({ path: rawPath, filename }) => {
    const localPath = resolveLocalPath(rawPath);
    if (!fs.existsSync(localPath)) return errorResult(`File not found: ${localPath}`);
    const stat = fs.statSync(localPath);
    if (!stat.isFile()) return errorResult(`Not a regular file: ${localPath}`);

    const buf = await fs.promises.readFile(localPath);
    const form = new FormData();
    const name = filename || path.basename(localPath);
    form.append("audio", new Blob([buf]), name);

    const res = await apiJson<KaraokeJob>("/api/jobs/upload", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return errorResult(`Upload failed (status ${res.status}): ${res.error}`);
    return textResult(summarizeJob(res.data));
  }
);

server.registerTool(
  "get_job",
  {
    title: "Get job status",
    description: "Fetches the current status, progress, and (when available) transcription/video URLs for a single job.",
    inputSchema: {
      jobId: z.string().describe("Job UUID returned by create_job_from_url or upload_audio_file"),
      includeTranscription: z.boolean().optional().describe("Include the full word-level transcription in the response"),
    },
  },
  async ({ jobId, includeTranscription }) => {
    const res = await apiJson<KaraokeJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) return errorResult(`Failed to fetch job (status ${res.status}): ${res.error}`);
    const summary = summarizeJob(res.data) as Record<string, unknown>;
    if (includeTranscription && res.data.transcription) summary.transcription = res.data.transcription;
    return textResult(summary);
  }
);

server.registerTool(
  "list_jobs",
  {
    title: "List jobs",
    description: "Lists all karaoke jobs known to the server, newest first.",
    inputSchema: {
      limit: z.number().int().positive().max(100).optional().describe("Cap the number of jobs returned"),
    },
  },
  async ({ limit }) => {
    const res = await apiJson<KaraokeJob[]>("/api/jobs");
    if (!res.ok) return errorResult(`Failed to list jobs (status ${res.status}): ${res.error}`);
    const jobs = (limit ? res.data.slice(0, limit) : res.data).map(summarizeJob);
    return textResult({ count: jobs.length, jobs });
  }
);

server.registerTool(
  "wait_for_job",
  {
    title: "Wait for job to finish",
    description:
      "Polls a job until it reaches `complete` or `error`, or until the timeout elapses. Returns the final job state.",
    inputSchema: {
      jobId: z.string().describe("Job UUID to wait on"),
      timeoutSeconds: z.number().int().positive().max(1800).optional().describe("Max seconds to wait (default 600)"),
      pollIntervalSeconds: z.number().positive().max(30).optional().describe("Seconds between polls (default 3)"),
    },
  },
  async ({ jobId, timeoutSeconds, pollIntervalSeconds }) => {
    const deadline = Date.now() + (timeoutSeconds ?? 600) * 1000;
    const interval = (pollIntervalSeconds ?? 3) * 1000;
    let last: KaraokeJob | undefined;
    while (Date.now() < deadline) {
      const res = await apiJson<KaraokeJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (!res.ok) return errorResult(`Failed to poll job (status ${res.status}): ${res.error}`);
      last = res.data;
      if (last.status === "complete" || last.status === "error") {
        return textResult(summarizeJob(last));
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    return errorResult(
      `Timed out after ${timeoutSeconds ?? 600}s. Last state: ${last ? `${last.status} (${last.progress}%) — ${last.statusMessage}` : "no response"}`
    );
  }
);

server.registerTool(
  "get_transcription",
  {
    title: "Get transcription",
    description: "Returns the word-level transcription for a job once transcribing has finished.",
    inputSchema: {
      jobId: z.string().describe("Job UUID"),
    },
  },
  async ({ jobId }) => {
    const res = await apiJson<KaraokeJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) return errorResult(`Failed to fetch job (status ${res.status}): ${res.error}`);
    if (!res.data.transcription) {
      return errorResult(
        `No transcription yet — job is ${res.data.status} (${res.data.progress}%): ${res.data.statusMessage}`
      );
    }
    return textResult(res.data.transcription);
  }
);

server.registerTool(
  "download_video",
  {
    title: "Download rendered video",
    description:
      "Downloads the rendered MP4 for a completed job to a local path on the machine running this MCP server. Returns the absolute path and byte size.",
    inputSchema: {
      jobId: z.string().describe("Job UUID of a completed job"),
      outputPath: z
        .string()
        .describe("Absolute path (or file:// URL) where the .mp4 will be written. Parent directory must exist."),
      overwrite: z.boolean().optional().describe("Overwrite if the file already exists (default false)"),
    },
  },
  async ({ jobId, outputPath, overwrite }) => {
    const dest = resolveLocalPath(outputPath);
    if (fs.existsSync(dest) && !overwrite) {
      return errorResult(`Refusing to overwrite ${dest} — pass overwrite: true to replace it.`);
    }
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) return errorResult(`Parent directory does not exist: ${parent}`);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/video/${encodeURIComponent(jobId)}/download`);
    } catch (e: any) {
      return errorResult(`Failed to reach API: ${e.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return errorResult(`Download failed (status ${res.status}): ${body || res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(dest, buf);
    return textResult({ path: dest, bytes: buf.byteLength });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // McpServer uses stdout for the MCP wire protocol, so log only to stderr.
  console.error(`karaoke MCP server connected (API_BASE=${API_BASE})`);
}

main().catch((err) => {
  console.error("Fatal MCP server error:", err);
  process.exit(1);
});
