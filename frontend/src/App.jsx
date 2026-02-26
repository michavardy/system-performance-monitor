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
  const step = data.length > 1 ? width / (data.length - 1) : width

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
        setError('Unable to update recording. Try again shortly.')
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
  const loadHistory = useMemo(
    () => history.map((snapshot) => snapshot?.load_average?.['1'] ?? 0),
    [history]
  )

  const networkRateHistory = useMemo(() => {
    const rates = []
    for (let i = 1; i < history.length; i += 1) {
      const prev = history[i - 1]?.network_io
      const current = history[i]?.network_io
      if (!prev || !current) {
        continue
      }
      const sent = Math.max(0, current.bytes_sent - prev.bytes_sent)
      const recv = Math.max(0, current.bytes_recv - prev.bytes_recv)
      rates.push((sent + recv) / 2)
    }
    return rates
  }, [history])

  const diskRateHistory = useMemo(() => {
    const rates = []
    for (let i = 1; i < history.length; i += 1) {
      const prev = history[i - 1]?.disk_io
      const current = history[i]?.disk_io
      if (!prev || !current) {
        continue
      }
      const read = Math.max(0, current.read_bytes - prev.read_bytes)
      const write = Math.max(0, current.write_bytes - prev.write_bytes)
      rates.push((read + write) / 2)
    }
    return rates
  }, [history])

  const latestNetworkDelta = useMemo(() => {
    if (history.length < 2) {
      return { deltaSent: 0, deltaRecv: 0 }
    }
    const prev = history[history.length - 2]?.network_io
    const current = history[history.length - 1]?.network_io
    if (!prev || !current) {
      return { deltaSent: 0, deltaRecv: 0 }
    }
    return {
      deltaSent: Math.max(0, current.bytes_sent - prev.bytes_sent),
      deltaRecv: Math.max(0, current.bytes_recv - prev.bytes_recv),
    }
  }, [history])

  const latestDiskDelta = useMemo(() => {
    if (history.length < 2) {
      return { deltaRead: 0, deltaWrite: 0 }
    }
    const prev = history[history.length - 2]?.disk_io
    const current = history[history.length - 1]?.disk_io
    if (!prev || !current) {
      return { deltaRead: 0, deltaWrite: 0 }
    }
    return {
      deltaRead: Math.max(0, current.read_bytes - prev.read_bytes),
      deltaWrite: Math.max(0, current.write_bytes - prev.write_bytes),
    }
  }, [history])

  const formattedTimestamp = metrics?.timestamp ? new Date(metrics.timestamp).toLocaleTimeString() : ''

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-text">
          <p className="eyebrow">System Monitor</p>
          <h1>System Performance Monitor</h1>
          <p className="subtitle">Clean, lightweight telemetry with responsive polling.</p>
        </div>
        <div className="header-actions">
          <div className={`recording-indicator ${recordingMeta.active ? 'active' : ''}`}>
            <span className="indicator-dot" />
            <div>
              <p>{recordingMeta.active ? 'Recording live' : 'Ready'}</p>
              <p>{formatDuration(timerSeconds)}</p>
            </div>
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
            <span className="widget-kicker">{formattedTimestamp}</span>
          </div>
          <Sparkline data={cpuHistory} color="#7dd3fc" />
          <div className="core-grid">
            {metrics?.cpu?.per_core?.map((value, index) => {
              const safeValue = typeof value === 'number' ? value : 0
              const bounded = Math.min(Math.max(safeValue, 0), 100)
              return (
                <div key={index} className="core-pill">
                  <div className="core-bar">
                    <div className="core-fill" style={{ height: `${bounded}%` }} />
                    <span>{bounded}%</span>
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
            <span className="widget-kicker">
              {metrics ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}` : ''}
            </span>
          </div>
          <Sparkline data={memoryHistory} color="#a855f7" />
          <div className="memory-bar">
            <div className="memory-fill" style={{ width: metrics ? `${metrics.memory.percent}%` : '0%' }} />
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Load Average</p>
              <p className="widget-value">{metrics?.load_average?.['1'] ?? '--'}</p>
            </div>
            <span className="widget-kicker">1m</span>
          </div>
          <Sparkline data={loadHistory} color="#38bdf8" />
          <div className="load-grid">
            {['1', '5', '15'].map((field) => (
              <div key={field} className="load-cell">
                <span className="load-label">{field}m</span>
                <strong className="load-value">{metrics?.load_average?.[field] ?? '--'}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Network I/O</p>
              <p className="widget-value">{formatBytes(latestNetworkDelta.deltaSent)}/s</p>
            </div>
            <span className="widget-kicker">{formatBytes(latestNetworkDelta.deltaRecv)}/s</span>
          </div>
          <Sparkline data={networkRateHistory} color="#22c55e" />
          <div className="io-grid">
            <div className="io-tile">
              <p>Sent</p>
              <strong>{formattedTimestamp ? formatBytes(metrics?.network_io?.bytes_sent ?? 0) : '--'}</strong>
            </div>
            <div className="io-tile">
              <p>Recv</p>
              <strong>{formattedTimestamp ? formatBytes(metrics?.network_io?.bytes_recv ?? 0) : '--'}</strong>
            </div>
          </div>
        </article>

        <article className="widget">
          <div className="widget-heading">
            <div>
              <p className="widget-label">Disk I/O</p>
              <p className="widget-value">{formatBytes(latestDiskDelta.deltaRead)}/s</p>
            </div>
            <span className="widget-kicker">{formatBytes(latestDiskDelta.deltaWrite)}/s</span>
          </div>
          <Sparkline data={diskRateHistory} color="#fb7185" />
          <div className="io-grid">
            <div className="io-tile">
              <p>Read</p>
              <strong>{formattedTimestamp ? formatBytes(metrics?.disk_io?.read_bytes ?? 0) : '--'}</strong>
            </div>
            <div className="io-tile">
              <p>Write</p>
              <strong>{formattedTimestamp ? formatBytes(metrics?.disk_io?.write_bytes ?? 0) : '--'}</strong>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}

export default App
