import { api } from "./api.ts"

/**
 * One aggregated history bucket as the hub returns it for `series=metrics`:
 * the averages over the bucket plus `minutes`, the count of one-minute
 * samples folded into it. `minutes` against the bucket's own width is the
 * coverage the availability figures divide by -- the only honest numerator
 * the history carries, since a bucket exists at all only where the agent
 * reported at least once inside it.
 */
export type MetricRow = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  minutes: number
}

export type HistoryData = {
  rows: MetricRow[]
  /** Seconds each bucket spans, as the hub reports it. */
  step: number
}

type RawRow = Partial<Record<keyof MetricRow, unknown>>

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null

function shape(raw: { metrics?: unknown; step?: unknown }): HistoryData | null {
  if (!Array.isArray(raw.metrics)) return null
  const step = num(raw.step)
  if (!step || step <= 0) return null
  const rows: MetricRow[] = []
  for (const r of raw.metrics as RawRow[]) {
    const row = {
      ts: num(r?.ts),
      cpu: num(r?.cpu),
      mem_used: num(r?.mem_used),
      disk_used: num(r?.disk_used),
      net_rx: num(r?.net_rx),
      net_tx: num(r?.net_tx),
      minutes: num(r?.minutes),
    }
    if (Object.values(row).some((v) => v === null)) continue
    rows.push(row as MetricRow)
  }
  rows.sort((a, b) => a.ts - b.ts)
  return rows.length ? { rows, step } : null
}

// Shared with the report, which walks the whole fleet: one cache, one gate.
// The hub refuses history scans past four in flight; three stays under it
// alongside whatever the detail page is already drawing.
const CACHE = new Map<string, { at: number; data: HistoryData | null }>()
const INFLIGHT = new Map<string, Promise<HistoryData | null>>()
const TTL = 300_000

let running = 0
const queue: (() => void)[] = []
function acquire(): Promise<void> {
  if (running < 3) {
    running++
    return Promise.resolve()
  }
  return new Promise((resolve) => queue.push(resolve))
}
function release() {
  const next = queue.shift()
  if (next) next()
  else running--
}

/**
 * A node's metrics history at the hub's full point budget, null on any
 * failure or an empty window: callers treat both as "no data to reason
 * from" and say so rather than guess.
 */
export function fetchMetricsHistory(id: number, hours: number): Promise<HistoryData | null> {
  const key = `${id}:${hours}`
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data)
  const pending = INFLIGHT.get(key)
  if (pending) return pending
  const task = (async () => {
    await acquire()
    try {
      const raw = await api<{ metrics?: unknown; step?: unknown }>(
        `/nodes/${id}/metrics?hours=${hours}&points=1440&series=metrics`,
      )
      const data = shape(raw)
      CACHE.set(key, { at: Date.now(), data })
      return data
    } catch {
      CACHE.set(key, { at: Date.now(), data: null })
      return null
    } finally {
      release()
      INFLIGHT.delete(key)
    }
  })()
  INFLIGHT.set(key, task)
  return task
}

/**
 * The share of the window the agent actually reported through, and the
 * window's true span in days. The span runs first bucket to last rather
 * than the requested width, so the days before a node joined are not
 * counted against it; the gaps between buckets are, which is the point.
 */
export function availabilityOf(data: HistoryData): { pct: number; spanDays: number } | null {
  const { rows, step } = data
  if (rows.length < 2) return null
  const first = rows[0].ts
  const last = rows[rows.length - 1].ts
  const spanSec = last + step - first
  if (spanSec <= 0) return null
  const stepMin = step / 60
  const covered = rows.reduce((t, r) => t + Math.min(Math.max(r.minutes, 0), stepMin), 0)
  const pct = Math.min(100, (covered / (spanSec / 60)) * 100)
  return { pct, spanDays: spanSec / 86400 }
}

/**
 * When the disk fills at its recent pace: a least-squares line over the
 * last seven days of `disk_used`, projected against the space left.
 * Returns null where the line cannot support a claim -- a span under
 * three days, no upward slope, or a fill date past the ninety days the
 * panel will print -- so the caller stays silent instead of inventing.
 */
export function diskForecast(
  data: HistoryData,
  diskTotal: number,
  usedNow: number,
): { days: number; perDay: number } | null {
  if (diskTotal <= 0) return null
  const { rows } = data
  if (rows.length < 2) return null
  const end = rows[rows.length - 1].ts
  const week = rows.filter((r) => r.ts >= end - 7 * 86400)
  if (week.length < 2) return null
  const spanDays = (week[week.length - 1].ts - week[0].ts) / 86400
  if (spanDays < 3) return null
  const n = week.length
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (const r of week) {
    const x = r.ts / 86400
    sx += x
    sy += r.disk_used
    sxy += x * r.disk_used
    sxx += x * x
  }
  const denom = n * sxx - sx * sx
  if (denom <= 0) return null
  const perDay = (n * sxy - sx * sy) / denom
  if (!(perDay > 0)) return null
  const remaining = diskTotal - usedNow
  if (remaining <= 0) return null
  const days = remaining / perDay
  if (days > 90) return null
  return { days, perDay }
}
