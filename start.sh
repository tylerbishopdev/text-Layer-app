#!/bin/bash
set -e

echo "Starting Karaoke Generator..."

# Start the Python API server in the background
echo "Starting Python API server on port 8000..."
python3 -m uvicorn api_server:app --host 0.0.0.0 --port 8000 &
PYTHON_PID=$!

# Wait for Python server to be ready
echo "Waiting for Python API..."
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8000/api/health > /dev/null 2>&1; then
        echo "Python API is ready."
        break
    fi
    if ! kill -0 $PYTHON_PID 2>/dev/null; then
        echo "Python API failed to start!"
        exit 1
    fi
    sleep 1
done

# Start the Node.js server (foreground, uses PORT env var)
echo "Starting Node.js server on port ${PORT:-5000}..."
exec node dist/index.cjs
