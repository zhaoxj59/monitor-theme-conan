import { useEffect, useState } from "react"

import { api } from "@/lib/api"

/**
 * One hub bucket for one probe. `latency` is the median of the samples that
 * answered, null when every sample in the bucket timed out; `loss` is the
 * percentage of the bucket that timed out, absent when none did. The hub's
 * top-level `loss` map is the same figure for the whole window, per probe --
 * the only accurate one, since the buckets' denominators are gone by then.
 */
type PingPoint = { task_id: number; ts: number; latency: number | null; loss?: number }

export type ProbeSeries = {
  id: number
  name: string
  /** Bucket latencies in time order, null where every probe in the bucket timed out. */
  values: (number | null)[]
  /** Per-bucket timeout percentage, aligned with `values`; 0 where the hub sent none. */
  losses: number[]
  /** The most recent answered sample, null when the probe never answered in the window. */
  last: number | null
  /** Whole-window loss percentage from the hub's `loss` map, 0 when absent. */
  loss: number
}

export type PingData = { probes: ProbeSeries[] }

type Raw = {
  ping: PingPoint[]
  probes: Record<string, string>
  loss?: Record<string, number>
}

function shape(raw: Raw): PingData {
  const ids = [...new Set(raw.ping.map((p) => p.task_id))]
  return {
    probes: ids.map((id) => {
      const rows = raw.ping.filter((p) => p.task_id === id)
      const values = rows.map((p) => p.latency)
      const answered = values.filter((v) => v !== null)
      return {
        id,
        name: raw.probes?.[id] ?? `探测 ${id}`,
        values,
        losses: rows.map((p) => p.loss ?? 0),
        last: answered.length ? answered[answered.length - 1] : null,
        loss: raw.loss?.[id] ?? 0,
      }
    }),
  }
}

/**
 * How one strip cell reads, judged against the probe's own baseline rather
 * than an absolute scale: an overseas route whose normal is 180 ms must not
 * paint as degraded for living at 180 ms. Answered buckets climb three
 * classes against that baseline -- `ok`, `warn`, then `high` -- and red is
 * spent on one thing only: `lost`, a bucket where nothing answered, so a
 * timeout never hides inside the slowness scale. `bad` survives in the type
 * for the resource strips' absolute tiers (lib shares the colour table);
 * latency never yields it. `none` is a slot the series does not reach yet,
 * no sample behind it at all.
 */
export type CellClass = "ok" | "warn" | "high" | "bad" | "lost" | "none"

export type PingCell = {
  /** The bucket's median latency, null when it never answered or is padding. */
  v: number | null
  /** The bucket's timeout percentage. */
  loss: number
  cls: CellClass
}

/**
 * The baseline of one probe on one node: the median of the window's answered
 * buckets. Null when nothing answered in the window -- the whole strip is
 * then lost, which is also how an offline node reads.
 */
export function baselineOf(values: (number | null)[]): number | null {
  const answered = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (!answered.length) return null
  const mid = Math.floor(answered.length / 2)
  return answered.length % 2 ? answered[mid] : (answered[mid - 1] + answered[mid]) / 2
}

/**
 * An answered bucket against its baseline. Both a ratio and an absolute
 * excess must stay small for green: the ratio alone would paint a 5 ms route
 * as degraded for reaching 30 ms, the excess alone would call a doubled
 * 40 ms route fine. The bands are deliberately tighter than a median
 * baseline's natural spread -- half the window sits at or below the median
 * by construction, so wide bands would paint nearly everything green and
 * say nothing. Anything answered past the yellow band is `high` (orange);
 * red belongs to timeouts alone. The floor of 1 ms keeps a zero baseline
 * from dividing by it.
 */
export function classifyCell(v: number, baseline: number): "ok" | "warn" | "high" {
  const excess = v - baseline
  const ratio = v / Math.max(baseline, 1)
  if (ratio <= 1.15 && excess <= 15) return "ok"
  if (ratio <= 1.4 && excess <= 40) return "warn"
  return "high"
}

/**
 * Resample a series onto exactly `cells` slots by nearest position, so a strip
 * always fills its row whatever bucket width the hub chose for the window,
 * and classify each slot against the series' baseline. Leading slots of a
 * series shorter than the strip are padding (`none`), not timeouts: the
 * probe simply has no sample that far back.
 */
export function probeCells(probe: ProbeSeries, cells: number): PingCell[] {
  const baseline = baselineOf(probe.values)
  const classify = (v: number | null): CellClass =>
    v === null || baseline === null ? "lost" : classifyCell(v, baseline)
  const { values, losses } = probe
  if (values.length === 0) return Array.from({ length: cells }, () => ({ v: null, loss: 0, cls: "none" as const }))
  if (values.length >= cells) {
    return Array.from({ length: cells }, (_, i) => {
      const j = Math.floor(((i + 0.5) * values.length) / cells)
      return { v: values[j], loss: losses[j] ?? 0, cls: classify(values[j]) }
    })
  }
  const pad = cells - values.length
  return [
    ...Array.from({ length: pad }, () => ({ v: null, loss: 0, cls: "none" as const })),
    ...values.map((v, j) => ({ v, loss: losses[j] ?? 0, cls: classify(v) })),
  ]
}

/** Every slot lost: a node that is down, whatever its window still holds. */
export function timeoutCells(cells: number): PingCell[] {
  return Array.from({ length: cells }, () => ({ v: null, loss: 100, cls: "lost" as const }))
}

/**
 * What the row's number says now: the newest bucket, not the newest answer.
 * A probe whose latest bucket went unanswered reads as a timeout in the lost
 * colour rather than quoting a stale figure in green.
 */
export function probeNow(probe: ProbeSeries): { timeout: true } | { timeout: false; v: number; cls: Exclude<CellClass, "none"> } {
  const newest = probe.values[probe.values.length - 1]
  if (newest === undefined || newest === null) return { timeout: true }
  const baseline = baselineOf(probe.values)
  return { timeout: false, v: newest, cls: baseline === null ? "lost" : classifyCell(newest, baseline) }
}

// Module-level cache: every card asks for its own node, the summary asks for the
// whole fleet, and the detail page for a wider window. A result is reused for a
// minute, which at the hub's two-second push cadence still reads as current for
// a strip whose last cell spans fifteen minutes of the card window.
const CACHE = new Map<string, { at: number; data: PingData | null }>()
const INFLIGHT = new Map<string, Promise<PingData | null>>()
const TTL = 60_000

// The hub caps how many history windows it builds at once, and eight cards plus
// a summary asking together would trip it; three in flight is under its limit
// and a fleet of cards still fills within a couple of seconds.
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

/** Ping history for one node, null on any failure: callers hide the section. */
export function fetchPing(id: number, hours: number, points: number): Promise<PingData | null> {
  const key = `${id}:${hours}:${points}`
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data)
  const pending = INFLIGHT.get(key)
  if (pending) return pending
  const task = (async () => {
    await acquire()
    try {
      const raw = await api<Raw>(`/nodes/${id}/metrics?hours=${hours}&points=${points}&series=ping`)
      const data = raw.ping.length ? shape(raw) : null
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

/** React view of {@link fetchPing}: undefined while loading, null on failure. */
export function usePing(id: number, hours: number, points: number): PingData | null | undefined {
  const [data, setData] = useState<PingData | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    fetchPing(id, hours, points).then((next) => {
      if (active) setData(next)
    })
    return () => {
      active = false
    }
  }, [id, hours, points])
  return data
}
