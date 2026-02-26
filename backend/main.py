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

    processes: List[Dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            cpu_percent = proc.cpu_percent(interval=None)
            info = proc.info
            info["cpu_percent"] = cpu_percent
            info["memory_percent"] = info.get("memory_percent", 0.0)
            processes.append(
                {
                    "pid": info.get("pid"),
                    "name": info.get("name") or "unknown",
                    "cpu_percent": round(info.get("cpu_percent", 0.0), 1),
                    "memory_percent": round(info.get("memory_percent", 0.0), 1),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    processes = sorted(processes, key=lambda p: p["cpu_percent"], reverse=True)[:10]

    snapshot = {
        "timestamp": timestamp,
        "cpu": {
            "total": round(total_cpu, 1),
            "per_core": [round(core, 1) for core in per_core],
        },
        "memory": {
            "total": memory.total,
            "used": memory.used,
            "percent": round(memory.percent, 1),
        },
        "load_average": {
            "1": round(load1, 2) if load1 is not None else None,
            "5": round(load5, 2) if load5 is not None else None,
            "15": round(load15, 2) if load15 is not None else None,
        },
        "disk_io": {
            "read_bytes": disk.read_bytes,
            "write_bytes": disk.write_bytes,
            "read_count": disk.read_count,
            "write_count": disk.write_count,
        },
        "network_io": {
            "bytes_sent": net.bytes_sent,
            "bytes_recv": net.bytes_recv,
            "packets_sent": net.packets_sent,
            "packets_recv": net.packets_recv,
            "errin": net.errin,
            "errout": net.errout,
        },
        "top_processes": processes,
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
        time.sleep(2)


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
        "top_processes",
    ]
    writer.writerow(header)

    for sample in data:
        top_proc_str = ";".join(
            f"{proc['name']}({proc['pid']}):{proc['cpu_percent']}%" for proc in sample.get("top_processes", [])
        )
        writer.writerow(
            [
                sample["timestamp"],
                sample["cpu"]["total"],
                sample["memory"]["used"],
                sample["memory"]["total"],
                sample["memory"]["percent"],
                sample["load_average"]["1"],
                sample["load_average"]["5"],
                sample["load_average"]["15"],
                sample["disk_io"]["read_bytes"],
                sample["disk_io"]["write_bytes"],
                sample["network_io"]["bytes_sent"],
                sample["network_io"]["bytes_recv"],
                top_proc_str,
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
