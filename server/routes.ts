import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { createJobFromUrlSchema } from "@shared/schema";

const upload = multer({
  dest: "/tmp/karaoke_uploads/",
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".wav", ".mp3", ".m4a", ".ogg", ".opus", ".webm", ".flac"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files (.wav, .mp3, .m4a, .ogg, .opus, .webm, .flac) are accepted"));
    }
  },
});

const PYTHON_API = "http://127.0.0.1:8000";

async function fetchPython(endpoint: string, body: any, options?: { timeout?: number; formData?: FormData }) {
  const controller = new AbortController();
  const timeout = options?.timeout || 120000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${PYTHON_API}${endpoint}`, {
      method: "POST",
      headers: options?.formData ? {} : { "Content-Type": "application/json" },
      body: options?.formData || JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Python API error: ${res.status} - ${text}`);
    }
    return await res.json();
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  }
}

async function processJob(jobId: string) {
  const job = storage.getJob(jobId);
  if (!job) return;

  try {
    let audioPath: string;
    let title: string;

    // Step 1: Get audio
    if (job.sourceType === "url") {
      storage.updateJobStatus(jobId, "downloading", 10, "Extracting audio from URL...");

      const result = await fetchPython("/api/extract-audio", {
        url: job.sourceUrl,
        job_id: jobId,
      }, { timeout: 180000 });

      audioPath = result.audio_path;
      title = result.title || "Karaoke";
    } else {
      // Audio was uploaded directly - path is already set
      audioPath = job.audioPath!;
      title = job.title || job.fileName || "Karaoke";
    }

    storage.updateJobAudio(jobId, audioPath, title);
    storage.updateJobStatus(jobId, "transcribing", 30, "Transcribing lyrics with word timestamps...");

    // Step 2: Transcribe
    const transcription = await fetchPython("/api/transcribe", {
      audio_path: audioPath,
      job_id: jobId,
    }, { timeout: 180000 });

    if (!transcription.words || transcription.words.length === 0) {
      throw new Error("No lyrics detected in the audio. Make sure the audio contains vocal content.");
    }

    storage.updateJobTranscription(jobId, transcription);
    storage.updateJobStatus(jobId, "rendering", 60, "Rendering karaoke video...");

    // Step 3: Render video
    const videoResult = await fetchPython("/api/render", {
      audio_path: audioPath,
      transcription,
      job_id: jobId,
      title: title,
    }, { timeout: 360000 });

    storage.updateJobVideo(jobId, videoResult.video_path, videoResult.video_url);
    storage.updateJobStatus(jobId, "complete", 100, "Karaoke video ready!");

  } catch (error: any) {
    console.error(`Job ${jobId} failed:`, error);
    storage.updateJobError(jobId, error.message || "Unknown error occurred");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Ensure upload directory exists
  fs.mkdirSync("/tmp/karaoke_uploads/", { recursive: true });

  // Create job from URL
  app.post("/api/jobs/url", async (req: Request, res: Response) => {
    try {
      const parsed = createJobFromUrlSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
      }

      const job = storage.createJob("url", parsed.data.url);
      // Start processing in background
      processJob(job.id).catch(err => console.error("Job processing error:", err));
      res.status(201).json(job);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Create job from file upload
  app.post("/api/jobs/upload", upload.single("audio"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No audio file uploaded" });
      }

      const job = storage.createJob("upload", undefined, file.originalname);

      // Upload to Python API
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(file.path);
      const blob = new Blob([fileBuffer], { type: file.mimetype });
      formData.append("file", blob, file.originalname);
      formData.append("job_id", job.id);

      try {
        const uploadResult = await fetchPython("/api/upload-audio", {}, { formData, timeout: 60000 });
        storage.updateJobAudio(job.id, uploadResult.audio_path, uploadResult.title);
      } catch (e: any) {
        storage.updateJobError(job.id, `Upload failed: ${e.message}`);
        return res.status(201).json(storage.getJob(job.id));
      }

      // Clean up temp file
      fs.unlink(file.path, () => {});

      // Start processing in background
      processJob(job.id).catch(err => console.error("Job processing error:", err));
      res.status(201).json(job);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Get job status
  app.get("/api/jobs/:id", (req: Request, res: Response) => {
    const job = storage.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  });

  // List all jobs
  app.get("/api/jobs", (_req: Request, res: Response) => {
    res.json(storage.getAllJobs());
  });

  // Proxy video streaming from Python API
  app.get("/api/video/:id/stream", async (req: Request, res: Response) => {
    try {
      const response = await fetch(`${PYTHON_API}/api/video/${req.params.id}/stream`);
      if (!response.ok) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.setHeader("Content-Type", "video/mp4");
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch {
      res.status(404).json({ error: "Video not found" });
    }
  });

  // Proxy video download from Python API
  app.get("/api/video/:id/download", async (req: Request, res: Response) => {
    try {
      const response = await fetch(`${PYTHON_API}/api/video/${req.params.id}`);
      if (!response.ok) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename="karaoke_${req.params.id}.mp4"`);
      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch {
      res.status(404).json({ error: "Video not found" });
    }
  });

  // Health check endpoint (used by Railway)
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "karaoke-generator" });
  });

  return httpServer;
}
