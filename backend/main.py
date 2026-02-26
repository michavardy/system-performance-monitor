from __future__ import annotations

import csv
import io
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import psutil
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="System Performance Monitor", version="1.0")

metrics_lock = threading.Lock()
recording_lock = threading.Lock()
latest_snapshot: Optional[Dict[str, Any]] = None
recording_active = False
recording_buffer: List[Dict[str, Any]] = []
recording_started_at: Optional[datetime] = None
sampler_thread: Optional[threading.Thread] = None

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def _safe_round(value: Optional[float], places: int = 1) -> Optional[float]:
    if value is None:
        return None
    return round(value, places)


def _coalesce(value: Optional[Any], default: Any = "") -> Any:
    return default if value is None else value


def _collect_snapshot() -> Dict[str, Any]:
    timestamp = datetime.utcnow().isoformat() + "Z"

    per_core = psutil.cpu_percent(interval=None, percpu=True)
    total_cpu = sum(per_core) / len(per_core) if per_core else psutil.cpu_percent(interval=None)

    memory = psutil.virtual_memory()

    try:
        load1, load5, load15 = psutil.getloadavg()
    except (AttributeError, OSError):
        load1 = load5 = load15 = None

    disk = psutil.disk_io_counters()
    net = psutil.net_io_counters()

    snapshot = {
        "timestamp": timestamp,
        "cpu": {
            "total": _safe_round(total_cpu),
            "per_core": [round(core, 1) for core in per_core],
        },
        "memory": {
            "total": memory.total,
            "used": memory.used,
            "percent": _safe_round(memory.percent),
        },
        "load_average": {
            "1": _safe_round(load1, 2),
            "5": _safe_round(load5, 2),
            "15": _safe_round(load15, 2),
        },
        "disk_io": {
            "read_bytes": disk.read_bytes if disk else 0,
            "write_bytes": disk.write_bytes if disk else 0,
            "read_count": disk.read_count if disk else 0,
            "write_count": disk.write_count if disk else 0,
        },
        "network_io": {
            "bytes_sent": net.bytes_sent if net else 0,
            "bytes_recv": net.bytes_recv if net else 0,
            "packets_sent": net.packets_sent if net else 0,
            "packets_recv": net.packets_recv if net else 0,
            "errin": net.errin if net else 0,
            "errout": net.errout if net else 0,
        },
    }

    return snapshot


def _sampler_loop() -> None:
    global latest_snapshot
    while True:
        snapshot = _collect_snapshot()
        with metrics_lock:
            latest_snapshot = snapshot
        with recording_lock:
            if recording_active:
                recording_buffer.append(snapshot)
        time.sleep(1)


def _ensure_sampler() -> None:
    global sampler_thread

    if sampler_thread and sampler_thread.is_alive():
        return

    sampler_thread = threading.Thread(target=_sampler_loop, daemon=True)
    sampler_thread.start()


@app.on_event("startup")
def startup_event() -> None:
    psutil.cpu_percent(interval=None)
    _ensure_sampler()


@app.get("/metrics")
def get_metrics() -> Dict[str, Any]:
    with metrics_lock:
        snapshot = latest_snapshot
    if snapshot is None:
        raise HTTPException(status_code=503, detail="Metrics not ready yet")

    with recording_lock:
        active = recording_active
        started_at = recording_started_at

    response = snapshot.copy()
    response["recording"] = {
        "active": active,
        "started_at": started_at.isoformat() + "Z" if started_at else None,
    }
    return response


@app.post("/record/start")
def start_recording() -> Dict[str, str]:
    global recording_active, recording_buffer, recording_started_at

    with recording_lock:
        if recording_active:
            return {"status": "already recording"}
        recording_buffer = []
        recording_active = True
        recording_started_at = datetime.utcnow()

    return {"status": "recording"}


@app.post("/record/stop")
def stop_recording() -> Dict[str, str]:
    global recording_active, recording_started_at

    with recording_lock:
        if not recording_active:
            return {"status": "not recording"}
        recording_active = False
        recording_started_at = None

    return {"status": "stopped"}


@app.get("/record/download")
def download_recording() -> StreamingResponse:
    with recording_lock:
        data = list(recording_buffer)

    if not data:
        raise HTTPException(status_code=404, detail="No recording data available")

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    header = [
        "timestamp",
        "cpu_total",
        "memory_used",
        "memory_total",
        "memory_percent",
        "load1",
        "load5",
        "load15",
        "disk_read_bytes",
        "disk_write_bytes",
        "network_bytes_sent",
        "network_bytes_recv",
    ]
    writer.writerow(header)

    for sample in data:
        writer.writerow(
            [
                sample["timestamp"],
                sample["cpu"]["total"],
                sample["memory"]["used"],
                sample["memory"]["total"],
                sample["memory"]["percent"],
                _coalesce(sample["load_average"]["1"]),
                _coalesce(sample["load_average"]["5"]),
                _coalesce(sample["load_average"]["15"]),
                sample["disk_io"]["read_bytes"],
                sample["disk_io"]["write_bytes"],
                sample["network_io"]["bytes_sent"],
                sample["network_io"]["bytes_recv"],
            ]
        )

    buffer.seek(0)
    filename = f"recording-{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}.csv"
    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:
    @app.get("/")
    def _placeholder() -> Dict[str, str]:
        return {"detail": "Frontend assets not built yet"}
