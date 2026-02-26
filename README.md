# System Performance Monitor

A lean FastAPI backend with a polished React/Vite dashboard that polls system metrics every two seconds, keeps only the latest snapshot in memory, and exposes recording controls with CSV export. The UI runs from the same server, keeps a rolling history for charts, and displays clean widgets for CPU, memory, load average, network I/O, and disk I/O.

## Features

- FastAPI backend with a single daemon sampler thread that polls `psutil` every 1 second and keeps the latest snapshot plus an optional recording buffer
- `GET /metrics` returns the current snapshot plus recording status, while `/record/start`, `/record/stop`, and `/record/download` control and export recordings as CSV
- React + Vite dashboard polls `/metrics` every 2 seconds, maintains a 60-s history, renders sparkline graphs for CPU, memory, load, network, and disk, and shows a recording indicator with start/stop/download buttons in the header
- `start.sh` installs frontend dependencies (when needed), builds the Vite bundle, and launches the backend on port `7000` in the background so the terminal remains available; the process stops automatically if the terminal exits

## Layout

```
system-performance-monitor/
├── backend/       # FastAPI service, sampler thread, recording endpoints, and static file server
├── frontend/      # React/Vite dashboard that polls the backend
├── start.sh       # Builds the frontend and runs uvicorn in the background on port 7000
└── README.md
```

## Getting Started

1. Install Python dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```

2. Run the bundled script (it will install npm deps if needed, rebuild the frontend, and start the backend in the background):
   ```bash
   ./start.sh
   ```

3. Visit [http://localhost:7000](http://localhost:7000) to view the dashboard. The process runs in the background and stops automatically when the terminal session ends.

## API Endpoints

- `GET /metrics` — returns the latest metrics snapshot including CPU, memory, load averages, disk I/O, network I/O, and recording status
- `POST /record/start` — begins capturing each sampled snapshot into an in-memory buffer
- `POST /record/stop` — stops the current recording session
- `GET /record/download` — streams a CSV that includes timestamp, CPU total, memory stats, load averages, disk counters, and network counters

## Notes

- The backend serves the built React assets from `frontend/dist`. Rebuild either by rerunning `start.sh` or manually running `npm run build` inside `frontend` after edits.
- Because the sampler thread keeps only the latest snapshot, the API remains lightweight and responsive while the UI relies solely on polling (no WebSockets).
