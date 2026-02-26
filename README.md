# System Performance Monitor

A lightweight FastAPI + React dashboard that samples host performance every two seconds, exposes the latest snapshot over a REST API, and renders a neon telemetry experience.

## Features

- FastAPI backend with a single background sampler thread powered by `psutil`
- Live metrics at `GET /metrics`, recording controls under `/record/*`, and CSV export
- React + Vite dashboard with animated widgets, sparkline charts, and a top CPU table
- Recording indicator, start/stop controls, and CSV download button
- Start-up script (`start.sh`) that builds the frontend and launches the backend on port `7000`

## Architecture

```
system-performance-monitor/
├── backend/       # FastAPI app with sampling thread and recording API
├── frontend/      # Vite + React dashboard polling the backend
├── start.sh       # Builds frontend assets (if needed) and runs uvicorn
└── README.md
```

The backend keeps only the latest snapshot in memory, samples CPU/memory/load/disk/network data every 2 seconds, and appends snapshots to an in-memory buffer while recording. The React frontend polls `/metrics` every 2 seconds, keeps a rolling 60-sample history, renders CPU/memory sparklines, shows top processes, and lets you control recordings.

## Getting Started

1. Install backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
2. Install frontend dependencies:
   ```bash
   cd frontend && npm install
   ```
3. Start the app (builds the frontend and launches uvicorn on port 7000):
   ```bash
   ./start.sh
   ```
4. Open [http://localhost:7000](http://localhost:7000) to view the dashboard.

## Recording Controls

- `POST /record/start` — begins capturing snapshots into an in-memory buffer
- `POST /record/stop` — stops the current recording
- `GET /record/download` — streams a CSV with timestamp, CPU, memory, load, disk, network, and top process summaries

The UI displays a pulsing red indicator and timer while recording, and the Download button retrieves the latest buffer as a CSV.

## Additional Notes

- The backend serves the built React assets from `frontend/dist`. Rebuild them whenever the UI changes using `npm run build` in the `frontend` directory or by rerunning `start.sh`.
- The sampler thread avoids per-request `psutil` calls so the API stays responsive while overhead remains minimal.
