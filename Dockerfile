# Multi-stage build: Node.js + Python + ffmpeg + yt-dlp
# -------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for npm
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install

# Copy source and build
COPY . .
RUN npm run build

# -------------------------------------------------------
# Production image
# -------------------------------------------------------
FROM node:20-bookworm-slim

# Install Python 3.11, ffmpeg, fonts, and system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libass9 \
    fonts-liberation \
    fonts-dejavu-core \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install Python dependencies
RUN python3 -m pip install --break-system-packages \
    fastapi \
    uvicorn[standard] \
    httpx \
    python-multipart

WORKDIR /app

# Copy built Node.js app from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy Python server files
COPY api_server.py .
COPY transcribe_audio.py .
COPY start.sh .
RUN chmod +x start.sh

# Create working directories
RUN mkdir -p /tmp/karaoke_jobs /tmp/karaoke_output /tmp/karaoke_uploads

# Railway provides PORT env var (usually 443 mapped to your app)
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["./start.sh"]
