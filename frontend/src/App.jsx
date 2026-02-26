import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const HISTORY_LIMIT = 60

const units = ['B', 'KB', 'MB', 'GB', 'TB']

const formatBytes = (value = 0) => {
  if (value === null || value === undefined) {
    return '--'
  }
  if (Math.abs(value) < 1) {
    return '0 B'
  }
  const order = Math.min(Math.floor(Math.log10(Math.abs(value)) / 3), units.length - 1)
  const scaled = value / Math.pow(1024, order)
  return `${scaled.toFixed(1)} ${units[order]}`
}

const formatDuration = (seconds = 0) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const Sparkline = ({ data = [], color = '#53f0ff' }) => {
  if (!data.length) {
    return <div className="sparkline blank" />
  }

  const width = 240
  const height = 60
  const maxValue = Math.max(...data)
  const minValue = Math.min(...data)
  const range = Math.max(maxValue - minValue, 1)
  const step = data.length > 1 ? (width / (data.length - 1)) : width

  const points = data
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - minValue) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
}

function App() {
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [recordingMeta, setRecordingMeta] = useState({ active: false, startedAt: null })
  const [timerSeconds, setTimerSeconds] = useState(0)

  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch('/metrics')
      if (!response.ok) {
        throw new Error('Unable to reach metrics endpoint')
      }
      const payload = await response.json()
      setMetrics(payload)
      setHistory((prev) => {
        const next = [...prev, payload]
        return next.slice(-HISTORY_LIMIT)
      })
      setRecordingMeta({
        active: payload.recording?.active ?? false,
        startedAt: payload.recording?.started_at ?? null,
      })
      setError('')
    } catch (err) {
      console.error(err)
      setError('Unable to load metrics. Ensure the backend is running.')
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 2000)
    return () => clearInterval(interval)
  }, [fetchMetrics])

  useEffect(() => {
    if (!recordingMeta.active || !recordingMeta.startedAt) {
      setTimerSeconds(0)
      return undefined
    }
    const start = Date.parse(recordingMeta.startedAt)
    if (Number.isNaN(start)) {
      return undefined
    }

    const tick = () => {
      const delta = Math.max(0, Math.floor((Date.now() - start) / 1000))
      setTimerSeconds(delta)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [recordingMeta])

  const handleRecord = useCallback(
    async (action) => {
      try {
        const response = await fetch(`/record/${action}`, { method: 'POST' })
        if (!response.ok) {
          throw new Error('Unable to update recording state')
        }
        await fetchMetrics()
      } catch (err) {
        console.error(err)
        setError('Unable to update recording. Try again in a moment.')
      }
    },
    [fetchMetrics]
  )

  const handleDownload = useCallback(async () => {
    try {
      const response = await fetch('/record/download')
      if (!response.ok) {
        throw new Error('No recording available yet')
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'system-performance-recording.csv'
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      setError('Recording CSV unavailable. Start a recording first.')
    }
  }, [])

  const cpuHistory = useMemo(() => history.map((snapshot) => snapshot?.cpu?.total ?? 0), [history])
  const memoryHistory = useMemo(() => history.map((snapshot) => snapshot?.memory?.percent ?? 0), [history])

  const latestNetwork = metrics?.network_io
  const prevNetwork = history.length > 1 ? history[history.length - 2]?.network_io : null
  const deltaNetwork = useMemo(() => {
    if (!latestNetwork || !prevNetwork) return { deltaSent: 0, deltaRecv: 0 }
    return {
      deltaSent: Math.max(0, latestNetwork.bytes_sent - prevNetwork.bytes_sent),
      deltaRecv: Math.max(0, latestNetwork.bytes_recv - prevNetwork.bytes_recv),
    }
  }, [latestNetwork, prevNetwork])

  const latestDisk = metrics?.disk_io
  const prevDisk = history.length > 1 ? history[history.length - 2]?.disk_io : null
  const deltaDisk = useMemo(() => {
    if (!latestDisk || !prevDisk) return { deltaRead: 0, deltaWrite: 0 }
    return {
      deltaRead: Math.max(0, latestDisk.read_bytes - prevDisk.read_bytes),
      deltaWrite: Math.max(0, latestDisk.write_bytes - prevDisk.write_bytes),
    }
  }, [latestDisk, prevDisk])

  const sparklineColor = '#7dd3fc'
  const memorySpark = '#a855f7'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Live System Telemetry</p>
          <h1>System Performance Monitor</h1>
          <p className="subtitle">Futuristic telemetry with responsive sampling, neon polish, and zero WebSocket debt.</p>
        </div>
        <div className={`recording-indicator ${recordingMeta.active ? 'active' : ''}`}>
          <span className="indicator-dot" />
          <div>
            <p>{recordingMeta.active ? 'Recording live' : 'Idle'}</p>
            <p>{formatDuration(timerSeconds)}</p>
          </div>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="widget-grid">
        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">CPU</p>
              <p className="widget-value">{metrics ? `${metrics.cpu.total}%` : '--'}</p>
            </div>
            <span className="widget-kicker">{metrics?.timestamp ? new Date(metrics.timestamp).toLocaleTimeString() : ''}</span>
          </div>
          <Sparkline data={cpuHistory} color={sparklineColor} />
          <div className="core-grid">
            {metrics?.cpu?.per_core?.map((value, index) => {
              const safeValue = typeof value === 'number' ? value : 0
              const bounded = Math.min(Math.max(safeValue, 0), 100)
              return (
                <div key={index} className="core-pill">
                  <div className="core-bar">
                    <div className="core-fill" style={{ height: `${bounded}%` }} />
                    <span className="core-value">{bounded}%</span>
                  </div>
                  <span className="core-label">Core {index + 1}</span>
                </div>
              )
            })}
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Memory</p>
              <p className="widget-value">{metrics ? `${metrics.memory.percent}%` : '--'}</p>
            </div>
            <span className="widget-kicker">{metrics ? formatBytes(metrics.memory.used) : ''} / {metrics ? formatBytes(metrics.memory.total) : ''}</span>
          </div>
          <Sparkline data={memoryHistory} color={memorySpark} />
          <div className="memory-bar">
            <div className="memory-fill" style={{ width: metrics ? `${metrics.memory.percent}%` : '0%' }} />
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Load Average</p>
              <p className="widget-value">{metrics ? 'system' : '--'}</p>
            </div>
          </div>
          <div className="load-grid">
            {['1', '5', '15'].map((field) => (
              <div key={field} className="load-cell">
                <span>{field}m</span>
                <strong>{metrics?.load_average?.[field] ?? '--'}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Network</p>
              <p className="widget-value">{metrics ? `${formatBytes(deltaNetwork.deltaSent)}/2s ↑` : '--'}</p>
            </div>
            <span className="widget-kicker">{metrics ? `${formatBytes(deltaNetwork.deltaRecv)}/2s ↓` : ''}</span>
          </div>
          <div className="io-grid">
            <div>
              <p>Sent</p>
              <strong>{metrics ? formatBytes(metrics.network_io.bytes_sent) : '--'}</strong>
            </div>
            <div>
              <p>Recv</p>
              <strong>{metrics ? formatBytes(metrics.network_io.bytes_recv) : '--'}</strong>
            </div>
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Disk I/O</p>
              <p className="widget-value">{metrics ? `${formatBytes(deltaDisk.deltaRead)}/2s ↗` : '--'}</p>
            </div>
            <span className="widget-kicker">{metrics ? `${formatBytes(deltaDisk.deltaWrite)}/2s ↘` : ''}</span>
          </div>
          <div className="io-grid">
            <div>
              <p>Read</p>
              <strong>{metrics ? formatBytes(metrics.disk_io.read_bytes) : '--'}</strong>
            </div>
            <div>
              <p>Write</p>
              <strong>{metrics ? formatBytes(metrics.disk_io.write_bytes) : '--'}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="process-section">
        <div className="section-header">
          <h2>Top Processes (by CPU)</h2>
          <p>Updated every two seconds with the latest snapshot.</p>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Process</th>
                <th>CPU %</th>
                <th>Memory %</th>
              </tr>
            </thead>
            <tbody>
              {metrics?.top_processes?.map((process) => (
                <tr key={`${process.pid}-${process.cpu_percent}`}>
                  <td>
                    <span className="process-name">{process.name}</span>
                    <span className="process-pid">PID {process.pid}</span>
                  </td>
                  <td>{process.cpu_percent}%</td>
                  <td>{process.memory_percent}%</td>
                </tr>
              ))}
              {!metrics?.top_processes?.length && (
                <tr>
                  <td colSpan={3} className="empty-row">
                    Capturing process data...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="recording-controls">
        <div>
          <p className="widget-label">Recording Controls</p>
          <p>Start or stop the sampling buffer and export CSV snapshots.</p>
        </div>
        <div className="button-row">
          <button onClick={() => handleRecord('start')} disabled={recordingMeta.active}>
            Start
          </button>
          <button onClick={() => handleRecord('stop')} disabled={!recordingMeta.active}>
            Stop
          </button>
          <button onClick={handleDownload}>Download CSV</button>
        </div>
      </section>
    </div>
  )
}

export default App
