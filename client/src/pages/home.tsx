import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Video,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Mic2,
  Play,
  ArrowRight,
} from "lucide-react";
import type { KaraokeJob } from "@shared/schema";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

import logoImg from "@assets/logo.png";
import previewImg from "@assets/image-asset.jpg";
import ovIconImg from "@assets/ovicon.jpg";
import mp3IconImg from "@assets/image-12.jpg";
import wavIconImg from "@assets/image-11.jpg";

const API_BASE = "";

export default function Home() {
  const [url, setUrl] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Poll active job
  const { data: activeJob } = useQuery<KaraokeJob>({
    queryKey: ["/api/jobs", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1500;
      if (data.status === "complete" || data.status === "error") return false;
      return 1500;
    },
  });

  // List past jobs
  const { data: jobs } = useQuery<KaraokeJob[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 5000,
  });

  // Submit URL
  const urlMutation = useMutation({
    mutationFn: async (videoUrl: string) => {
      const res = await apiRequest("POST", "/api/jobs/url", { url: videoUrl });
      return res.json() as Promise<KaraokeJob>;
    },
    onSuccess: (job) => {
      setActiveJobId(job.id);
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job started", description: "Extracting audio from URL..." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Upload file
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("audio", file);
      const res = await fetch(`${API_BASE}/api/jobs/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }
      return res.json() as Promise<KaraokeJob>;
    },
    onSuccess: (job) => {
      setActiveJobId(job.id);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Upload complete", description: "Processing audio..." });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    urlMutation.mutate(url.trim());
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  }, [uploadMutation]);

  const isProcessing = urlMutation.isPending || uploadMutation.isPending;

  const statusIcon = (status: string) => {
    switch (status) {
      case "complete": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error": return <XCircle className="h-4 w-4 text-red-500" />;
      case "downloading": return <Download className="h-4 w-4 text-amber-400 animate-pulse" />;
      case "transcribing": return <Mic2 className="h-4 w-4 text-amber-300 animate-pulse" />;
      case "rendering": return <Video className="h-4 w-4 text-amber-200 animate-pulse" />;
      default: return <Loader2 className="h-4 w-4 animate-spin text-amber-400/60" />;
    }
  };

  const completedJobs = jobs?.filter(j => j.status === "complete") || [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-dark)" }}>

      {/* Top gold line */}
      <div className="gold-line" />

      {/* Logo */}
      <div className="flex justify-center pt-6 pb-2">
        <img
          src={logoImg}
          alt="Text Layer"
          className="h-20 object-contain"
          style={{ mixBlendMode: "lighten" }}
          data-testid="logo"
        />
      </div>
      <p
        className="text-center text-xs tracking-[0.3em] uppercase mb-8"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        Audio to Karaoke Instantly
      </p>

      {/* Gold divider */}
      <div className="gold-line mx-auto" style={{ width: "80%", maxWidth: 700 }} />

      {/* Hero section — info + preview */}
      <div className="max-w-4xl mx-auto w-full px-6 py-8">
        <div className="flex flex-col md:flex-row items-center gap-8">
          {/* Left: tagline + format icons */}
          <div className="flex-1 text-center md:text-left space-y-4">
            <p className="text-sm md:text-base leading-relaxed" style={{ color: "rgba(255,255,255,0.85)" }}>
              <span className="font-semibold uppercase tracking-wide" style={{ color: "var(--gold)" }}>Turn MP3 & WAV files or Open.Video URLs</span>
              <br />
              <span style={{ color: "rgba(255,255,255,0.7)" }}>into </span>
              <span className="font-semibold underline decoration-1 underline-offset-2" style={{ color: "rgba(255,255,255,0.9)" }}>perfect</span>
              {" "}
              <span className="font-semibold" style={{ color: "var(--pink-highlight)" }}>word-tracking karaoke video</span>
              <br />
              <span className="font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>with lyrics</span>
              {" "}
              <span style={{ color: "rgba(255,255,255,0.6)" }}>automatically</span>
            </p>

            {/* Format icons row */}
            <div className="flex items-center justify-center md:justify-start gap-3 pt-2">
              <img src={ovIconImg} alt="Open.Video" className="h-9 w-auto rounded" style={{ mixBlendMode: "lighten" }} data-testid="icon-ov" />
              <img src={mp3IconImg} alt="MP3" className="h-9 w-auto rounded" data-testid="icon-mp3" />
              <img src={wavIconImg} alt="WAV" className="h-9 w-auto rounded" data-testid="icon-wav" />
              <ArrowRight className="h-5 w-5 arrow-animate" style={{ color: "var(--gold-dim)" }} />
            </div>
          </div>

          {/* Right: preview card */}
          <div className="preview-card w-64 shrink-0">
            <img
              src={previewImg}
              alt="Perfect lyric tracking preview"
              className="w-full rounded"
              data-testid="preview-image"
            />
          </div>
        </div>
      </div>

      {/* Gold divider */}
      <div className="gold-line mx-auto mb-8" style={{ width: "80%", maxWidth: 700 }} />

      {/* Rocket Sloth ad unit — above main content */}
      <div className="max-w-2xl mx-auto w-full px-6 mb-8">
        <div data-rs-ad data-rs-width="728" data-rs-height="90"></div>
      </div>

      {/* Main input area */}
      <div className="max-w-2xl mx-auto w-full px-6 pb-8 space-y-6">
        {/* Input card */}
        <div className="card-gold p-6 space-y-5">
          <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Paste An Open.Video Link Or Upload Audio. The App Transcribes Lyrics With
            <br />
            Precise Timestamps And Renders A Synced Karaoke Video.
          </p>

          {/* URL Input */}
          <div className="space-y-2">
            <label
              className="block text-sm font-medium text-center"
              style={{ color: "var(--gold-light)", fontStyle: "italic" }}
            >
              Paste Open.Video URL / Link
            </label>
            <form onSubmit={handleSubmitUrl} className="flex gap-2">
              <input
                type="url"
                placeholder="https://videos.example.org/v/my-video"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isProcessing}
                className="input-gold flex-1"
                data-testid="input-url"
              />
              <button
                type="submit"
                disabled={!url.trim() || isProcessing}
                className="btn-create shrink-0"
                data-testid="button-submit-url"
              >
                {urlMutation.isPending ? "..." : "Create"}
              </button>
            </form>
          </div>

          {/* OR divider */}
          <div className="or-divider">OR</div>

          {/* Upload section */}
          <div className="flex items-center gap-4">
            <label
              className="text-sm font-medium shrink-0"
              style={{ color: "var(--gold-light)" }}
            >
              Upload mp3 or .wav
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="dropzone-gold flex-1 flex items-center justify-center gap-2 py-4 px-6 cursor-pointer text-center"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,.m4a,.ogg,.opus,.webm,.flac"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file"
              />
              <Upload className="h-5 w-5" style={{ color: "var(--gold)" }} />
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Drop file or click
              </span>
            </div>
          </div>
        </div>

        {/* Active Job Progress */}
        {activeJob && activeJob.status !== "complete" && activeJob.status !== "error" && (
          <div className="card-gold p-5 space-y-3" data-testid="card-progress">
            <div className="flex items-center gap-3">
              {statusIcon(activeJob.status)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "rgba(255,255,255,0.9)" }}>
                  {activeJob.title || activeJob.fileName || activeJob.sourceUrl || "Processing..."}
                </p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{activeJob.statusMessage}</p>
              </div>
              <Badge variant="outline" className="shrink-0 capitalize text-xs" style={{ borderColor: "var(--amber-border)", color: "var(--gold)" }}>
                {activeJob.status}
              </Badge>
            </div>
            <div className="progress-glow rounded-full">
              <Progress value={activeJob.progress} className="h-2" data-testid="progress-bar" />
            </div>
          </div>
        )}

        {/* Active Job Error */}
        {activeJob && activeJob.status === "error" && (
          <div className="card-gold p-5" style={{ borderColor: "rgba(220, 60, 60, 0.3)" }} data-testid="card-error">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.9)" }}>Processing failed</p>
                <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>{activeJob.error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Active Job Complete */}
        {activeJob && activeJob.status === "complete" && (
          <div className="card-gold p-5 space-y-4" style={{ borderColor: "rgba(80, 180, 80, 0.3)" }} data-testid="card-complete">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.9)" }}>{activeJob.title || "Karaoke video ready"}</p>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>Your karaoke video is ready to preview and download</p>
              </div>
            </div>

            {/* Video Preview */}
            <div className="rounded-lg overflow-hidden bg-black aspect-video" style={{ border: "1px solid var(--card-border-gold)" }}>
              <video
                controls
                className="w-full h-full"
                src={`${API_BASE}/api/video/${activeJob.id}/stream`}
                data-testid="video-preview"
              />
            </div>

            <button
              className="btn-create w-full flex items-center justify-center gap-2"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `${API_BASE}/api/video/${activeJob.id}/download`;
                a.download = `karaoke_${activeJob.title || activeJob.id}.mp4`;
                a.click();
              }}
              data-testid="button-download"
            >
              <Download className="h-4 w-4" />
              Download Video
            </button>
          </div>
        )}

        {/* Completed Jobs History */}
        {completedJobs.length > 0 && activeJob?.status === "complete" && completedJobs.length > 1 && (
          <div className="space-y-3">
            <h2 className="text-xs font-medium px-1" style={{ color: "rgba(255,255,255,0.35)" }}>Previous karaoke videos</h2>
            {completedJobs
              .filter(j => j.id !== activeJobId)
              .slice(0, 5)
              .map((job) => (
                <div key={job.id} className="card-gold py-3 px-4 flex items-center gap-3" data-testid={`card-history-${job.id}`}>
                  <Video className="h-4 w-4 shrink-0" style={{ color: "var(--gold-dim)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{job.title || job.fileName || "Untitled"}</p>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {new Date(job.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs"
                      style={{ color: "var(--gold)" }}
                      onClick={() => setActiveJobId(job.id)}
                      data-testid={`button-view-${job.id}`}
                    >
                      <Play className="h-3.5 w-3.5" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      style={{ borderColor: "var(--amber-border)", color: "var(--gold)" }}
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = `${API_BASE}/api/video/${job.id}/download`;
                        a.download = `karaoke_${job.title || job.id}.mp4`;
                        a.click();
                      }}
                      data-testid={`button-download-${job.id}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        )}

        <PerplexityAttribution />
      </div>

      {/* Rocket Sloth ad unit — below content, above footer */}
      <div className="max-w-2xl mx-auto w-full px-6 pb-10">
        <div data-rs-ad></div>
      </div>
    </div>
  );
}
