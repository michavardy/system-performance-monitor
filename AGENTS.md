# Agent Notes for system-performance-monitor

- Backend: FastAPI service in `backend/main.py`. A single daemon sampler thread polls `psutil` every 1 second, keeps only the latest snapshot, and appends to `recording_buffer` only while recording is active. Metrics include CPU (total + per-core), memory, load averages, disk I/O counters, and network counters.
- APIs: `GET /metrics` returns the current snapshot plus `recording.active/started_at`. Recording controls are `POST /record/start`, `POST /record/stop`, and `GET /record/download`, which streams CSV rows containing timestamp, CPU total, memory stats, load averages, disk I/O totals, and network I/O totals.
- Frontend: React + Vite dashboard polls `/metrics` every 2 seconds, keeps a 60-sample rolling history for sparklines, renders widgets for CPU, memory, load average, network I/O, and disk I/O (no process table), and places recording controls (start/stop/download) plus the red indicator/timer in the header.
- Running: `start.sh` installs npm deps if needed, rebuilds the frontend, and launches `uvicorn` on port 7000 in the background so the terminal remains free while the server follows the terminal session's lifetime.
