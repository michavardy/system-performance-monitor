# Agent Notes for system-performance-monitor

- Backend: FastAPI app in `backend/main.py` with `psutil` sampler thread running every 2 seconds. Only the latest snapshot is kept in `latest_snapshot`, and optionally recorded snapshots accumulate while recording is active.
- APIs: `GET /metrics`, `POST /record/start`, `POST /record/stop`, and `GET /record/download` (exports CSV with timestamp, CPU, memory, load, disk, network, and top process summaries). `/metrics` also surfaces `recording.active` / `started_at` for the UI.
- Frontend: React + Vite app under `frontend/` that polls `/metrics` every 2 seconds, keeps a 60-sample history, draws sparkline charts, lists the top CPU processes, and exposes recording controls plus a download button.
- Running: install Python deps (`pip install -r backend/requirements.txt`), install Node deps in `frontend/`, then run `./start.sh` from the repo root to build the frontend and start the backend on port 7000.
