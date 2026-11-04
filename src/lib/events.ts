import { daysOf } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { percent } from "@/lib/format"

/** A node counts as abnormal when it is down, hot, nearly full, or near expiry. */
export function abnormal(node: Node): boolean {
  if (!node.online) return true
  const days = daysOf(node)
  if (days !== null && days <= 30) return true
  const m = node.metrics
  return !!m && (m.cpu >= 85 || percent(m.mem_used, m.mem_total) >= 85 || percent(m.disk_used, m.disk_total) >= 90)
}

/** Why a node counts as abnormal, in the same terms `abnormal` judges by. */
export function reasonsOf(node: Node): string[] {
  const out: string[] = []
  if (!node.online) out.push("离线")
  const days = daysOf(node)
  if (days !== null && days <= 30) out.push(days < 0 ? `已过期 ${-days} 天` : `剩 ${days} 天到期`)
  const m = node.metrics
  if (m) {
    if (m.cpu >= 85) out.push(`CPU ${Math.round(m.cpu)}%`)
    const mem = percent(m.mem_used, m.mem_total)
    if (mem >= 85) out.push(`内存 ${Math.round(mem)}%`)
    const disk = percent(m.disk_used, m.disk_total)
    if (disk >= 90) out.push(`磁盘 ${Math.round(disk)}%`)
  }
  return out.length ? out : ["异常"]
}

export type EventKind = "offline" | "online" | "waiting" | "reporting" | "abnormal" | "resolved"

export type CaseEvent = {
  /** Epoch milliseconds, on the visitor's clock. */
  t: number
  id: number
  name: string
  kind: EventKind
  text: string
}

const KEY = "conan-events-v1"
const LIMIT = 200

/**
 * A change and its reversal closer together than this are one flap, not two
 * events: the pair is struck from the log rather than written into it.
 */
const FLAP_MS = 60_000

const isEvent = (v: unknown): v is CaseEvent => {
  if (typeof v !== "object" || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.t === "number" &&
    typeof e.id === "number" &&
    typeof e.name === "string" &&
    typeof e.text === "string" &&
    (e.kind === "offline" || e.kind === "online" || e.kind === "waiting" ||
      e.kind === "reporting" || e.kind === "abnormal" || e.kind === "resolved")
  )
}

function load(): CaseEvent[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEvent).slice(0, LIMIT) : []
  } catch {
    return []
  }
}

/**
 * The case log. The hub keeps no event history, so the log is written by
 * watching the live stream from inside the page and kept in the visitor's
 * browser: it survives reloads, and covers only the hours some tab running
 * this theme was open to see.
 */
let events: CaseEvent[] = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(events))
  } catch {
    // Full or refused storage costs the log its memory, not the page.
  }
}

function emit() {
  for (const fn of listeners) fn()
}

export function subscribeEvents(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getEvents(): CaseEvent[] {
  return events
}

export function clearEvents() {
  if (events.length === 0) return
  events = []
  persist()
  emit()
}

type Presence = "offline" | "waiting" | "reporting"

type Channels = {
  presence: Presence
  abnormal: boolean
}

const presenceOf = (node: Node): Presence =>
  !node.online ? "offline" : node.metrics ? "reporting" : "waiting"

/**
 * The abnormal channel runs only while a node is up. `abnormal` itself
 * counts being down, so without the gate a node would trip and clear in
 * step with its link, on top of its own offline and recovery entries.
 */
const channelsOf = (node: Node): Channels => ({
  presence: presenceOf(node),
  abnormal: node.online && abnormal(node),
})

const sameChannels = (a: Channels, b: Channels) => a.presence === b.presence && a.abnormal === b.abnormal

/** The event kind each kind undoes, where it has one. */
const UNDOES: Partial<Record<EventKind, EventKind>> = {
  online: "offline",
  reporting: "waiting",
  resolved: "abnormal",
  offline: "online",
  waiting: "reporting",
  abnormal: "resolved",
}

/** The kinds that close a condition out rather than open one. */
const CLOSING: Partial<Record<EventKind, true>> = { online: true, reporting: true, resolved: true }

function record(node: Node, kind: EventKind, text: string, now: number, seed = false) {
  const at = events.findIndex((e) => e.id === node.id)
  const last = at >= 0 ? events[at] : undefined
  const paired = UNDOES[kind]
  if (seed && last?.kind === kind) {
    // A reload finds the condition already the newest word on this node;
    // announcing it again would log the page's visits, not the node's life.
    return
  }
  if (paired && last?.kind === paired && now - last.t < FLAP_MS) {
    // Inside the flap window the pair cancels: the entry it answers is
    // struck and this one never lands. A closing entry (a recovery, a
    // clearing) then has nothing left to say. An opening one struck a
    // brief closing instead, and lands -- unless the entry that closing
    // had itself answered is newest on the node again, in which case the
    // condition never really cleared and needs no second entry.
    events = events.filter((_, i) => i !== at)
    if (CLOSING[kind] || events.find((e) => e.id === node.id)?.kind === kind) {
      persist()
      emit()
      return
    }
  }
  events = [{ t: now, id: node.id, name: node.name, kind, text }, ...events].slice(0, LIMIT)
  persist()
  emit()
}

/**
 * The entries one confirmed change from `from` to `to` leaves behind. While
 * a node is down its abnormal verdict is carried rather than judged: a node
 * that drops out mid-stretch and comes back as it left raises only its
 * offline and recovery entries, and one that comes back changed is judged
 * against the verdict it left with.
 */
function commit(node: Node, from: Channels, to: Channels) {
  const now = Date.now()
  if (to.presence !== from.presence) {
    if (to.presence === "offline") record(node, "offline", "离线", now)
    else if (from.presence === "offline") record(node, "online", "恢复上线", now)
    else if (to.presence === "waiting") record(node, "waiting", "等待上报", now)
    else record(node, "reporting", "恢复上报", now)
  }
  if (to.abnormal !== from.abnormal) {
    if (to.abnormal) record(node, "abnormal", reasonsOf(node).join(" · "), now)
    else record(node, "resolved", "异常解除", now)
  }
}

type Watch = {
  seen: Channels
  pending: Channels | null
  count: number
}

const watch = new Map<number, Watch>()
let seeded = false

/**
 * The first sight of a node starts its watch from the state it is in, and
 * leaves one entry for a condition already in force -- marked as found,
 * never backdated. Later sightings of a node added mid-session do the same.
 */
function startWatch(node: Node) {
  const c = channelsOf(node)
  watch.set(node.id, {
    seen: c.presence === "offline" ? { presence: "offline", abnormal: false } : c,
    pending: null,
    count: 0,
  })
  const now = Date.now()
  if (c.presence === "offline") record(node, "offline", "离线（打开页面时已离线）", now, true)
  else if (c.abnormal) record(node, "abnormal", `${reasonsOf(node).join(" · ")}（打开页面时已存在）`, now, true)
}

/**
 * Feeds one pushed snapshot into the log. A change is written only once a
 * second consecutive snapshot agrees with it -- the stream pushes every two
 * seconds, so a single-frame blip never reaches the log, and a real change
 * is written about two seconds after it is first seen.
 */
export function observeNodes(nodes: Node[]) {
  if (!seeded) {
    seeded = true
    for (const node of nodes) startWatch(node)
    return
  }
  const alive = new Set<number>()
  for (const node of nodes) {
    alive.add(node.id)
    const w = watch.get(node.id)
    if (!w) {
      startWatch(node)
      continue
    }
    const raw = channelsOf(node)
    // While the node is down its verdict is the one it left with, so the
    // candidate is built carrying it; judging it fresh would read false
    // against the watch and churn the pending state every frame.
    const cur: Channels =
      raw.presence === "offline" ? { presence: "offline", abnormal: w.seen.abnormal } : raw
    if (sameChannels(cur, w.seen)) {
      w.pending = null
      w.count = 0
      continue
    }
    if (w.pending && sameChannels(cur, w.pending)) w.count++
    else {
      w.pending = cur
      w.count = 1
    }
    if (w.count >= 2) {
      commit(node, w.seen, cur)
      w.seen = cur
      w.pending = null
      w.count = 0
    }
  }
  for (const id of watch.keys()) if (!alive.has(id)) watch.delete(id)
}
