import { z } from "zod";

// Job status type
export const jobStatuses = ["pending", "downloading", "transcribing", "rendering", "complete", "error"] as const;
export type JobStatus = typeof jobStatuses[number];

// A karaoke job
export interface KaraokeJob {
  id: string;
  status: JobStatus;
  progress: number; // 0-100
  statusMessage: string;
  sourceType: "url" | "upload";
  sourceUrl?: string;
  fileName?: string;
  title?: string;
  audioPath?: string;
  transcription?: TranscriptionResult;
  videoPath?: string;
  videoUrl?: string;
  createdAt: string;
  error?: string;
}

export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  speaker_id?: number;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptionWord[];
  language_code?: string;
}

// API request schemas
export const createJobFromUrlSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
});

export const createJobFromUploadSchema = z.object({
  fileName: z.string(),
});

export type CreateJobFromUrl = z.infer<typeof createJobFromUrlSchema>;
export type CreateJobFromUpload = z.infer<typeof createJobFromUploadSchema>;
