import { type KaraokeJob, type JobStatus, type TranscriptionResult } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  createJob(sourceType: "url" | "upload", sourceUrl?: string, fileName?: string): KaraokeJob;
  getJob(id: string): KaraokeJob | undefined;
  updateJobStatus(id: string, status: JobStatus, progress: number, message: string): void;
  updateJobAudio(id: string, audioPath: string, title?: string): void;
  updateJobTranscription(id: string, transcription: TranscriptionResult): void;
  updateJobVideo(id: string, videoPath: string, videoUrl: string): void;
  updateJobError(id: string, error: string): void;
  getAllJobs(): KaraokeJob[];
}

export class MemStorage implements IStorage {
  private jobs: Map<string, KaraokeJob>;

  constructor() {
    this.jobs = new Map();
  }

  createJob(sourceType: "url" | "upload", sourceUrl?: string, fileName?: string): KaraokeJob {
    const id = randomUUID();
    const job: KaraokeJob = {
      id,
      status: "pending",
      progress: 0,
      statusMessage: "Job created",
      sourceType,
      sourceUrl,
      fileName,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): KaraokeJob | undefined {
    return this.jobs.get(id);
  }

  updateJobStatus(id: string, status: JobStatus, progress: number, message: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      job.progress = progress;
      job.statusMessage = message;
    }
  }

  updateJobAudio(id: string, audioPath: string, title?: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.audioPath = audioPath;
      if (title) job.title = title;
    }
  }

  updateJobTranscription(id: string, transcription: TranscriptionResult): void {
    const job = this.jobs.get(id);
    if (job) {
      job.transcription = transcription;
    }
  }

  updateJobVideo(id: string, videoPath: string, videoUrl: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.videoPath = videoPath;
      job.videoUrl = videoUrl;
    }
  }

  updateJobError(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = "error";
      job.error = error;
      job.statusMessage = `Error: ${error}`;
    }
  }

  getAllJobs(): KaraokeJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
}

export const storage = new MemStorage();
