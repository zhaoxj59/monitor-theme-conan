import type { Node } from "./api.ts"
import { percent } from "./format.ts"
import type { PingData } from "./ping.ts"

/**
 * A node's health as one deterministic score out of 100, in four parts
 * whose weights are fixed here so the number means the same thing on
 * every card, in the detail breakdown and in the command centre:
 *
 * - 在线 25 —— reporting 25, waiting for its first report 10, offline 0.
 * - 资源 30 —— CPU, memory and disk at 10 apiece. CPU and memory pay 5
 *   between 70% and 85% used and everything past 85%; disk, which does
 *   not fall back on its own, pays 5 between 80% and 90% and everything
 *   past 90%. No live metrics, no credit.
 * - 到期 20 —— long-term or over 90 days out 20, 31–90 days 15, 8–30
 *   days 8, a week or less -- or already past -- 0.
 * - 探测 25 —— the node's ping window (the card's own six hours) starts
 *   at 25 and pays for what the line lost: half the weight on the
 *   window's bucket-weighted loss, half on the share of buckets where
 *   nothing answered at all.
 *
 * Where the probe window cannot speak -- the fetch failed, the node has
 * no probes, or fewer than ten buckets stand behind it -- the probe part
 * is struck rather than guessed, the other 75 points are scaled back up
 * to 100, and the breakdown flags the gap. A ping window still loading
 * scores nothing at all: the badge waits rather than flicker a number
 * the probe data is about to change.
 */

export type HealthGrade = "safe" | "watch" | "danger"

export type HealthPart = {
  key: "online" | "resource" | "expiry" | "probe"
  label: string
  got: number
  max: number
  note?: string
}

export type Health = {
  total: number
  grade: HealthGrade
  parts: HealthPart[]
  probeInsufficient: boolean
}

export const GRADE_LABEL: Record<HealthGrade, string> = {
  safe: "安全",
  watch: "注意",
  danger: "危险",
}

export const GRADE_COLOR: Record<HealthGrade, string> = {
  safe: "var(--tone-ok)",
  watch: "var(--tone-warn)",
  danger: "var(--tone-hot)",
}

const gradeOf = (total: number): HealthGrade => (total >= 85 ? "safe" : total >= 65 ? "watch" : "danger")

/** One resource's ten points: full, halved in the caution band, gone past it. */
function band(pct: number, mid: number, high: number): number {
  return pct < mid ? 10 : pct <= high ? 5 : 0
}

/**
 * The score for one node. `days` is the caller-resolved days-to-expiry
 * (lib callers pass `daysOf` from the card, so this module stays free of
 * component imports). `ping` follows lib/ping's tri-state: undefined
 * while loading (returns null), null on failure (scores without the
 * probe part).
 */
export function healthOf(node: Node, ping: PingData | null | undefined, days: number | null): Health | null {
  if (ping === undefined) return null
  const m = node.metrics

  const onlineGot = !node.online ? 0 : m ? 25 : 10
  const online: HealthPart = {
    key: "online",
    label: "在线",
    got: onlineGot,
    max: 25,
    note: !node.online ? "离线" : m ? "在线上报中" : "等待上报",
  }

  let resourceGot = 0
  let resourceNote: string | undefined
  if (m) {
    const cpu = m.cpu
    const mem = percent(m.mem_used, m.mem_total)
    const disk = percent(m.disk_used, m.disk_total)
    resourceGot = band(cpu, 70, 85) + band(mem, 70, 85) + band(disk, 80, 90)
    resourceNote = `CPU ${Math.round(cpu)}% · 内存 ${Math.round(mem)}% · 磁盘 ${Math.round(disk)}%`
  } else {
    resourceNote = "暂无上报数据"
  }
  const resource: HealthPart = { key: "resource", label: "资源", got: resourceGot, max: 30, note: resourceNote }

  const expiryGot = days === null || days > 90 ? 20 : days >= 31 ? 15 : days >= 8 ? 8 : 0
  const expiry: HealthPart = {
    key: "expiry",
    label: "到期",
    got: expiryGot,
    max: 20,
    note: days === null ? "长期" : days < 0 ? `已过期 ${-days} 天` : `剩 ${days} 天`,
  }

  let probeGot: number | null = null
  let probeNote: string | undefined
  if (ping && ping.probes.length > 0) {
    const buckets = ping.probes.reduce((t, p) => t + p.values.length, 0)
    if (buckets >= 10) {
      const lost = ping.probes.reduce((t, p) => t + p.values.filter((v) => v === null).length, 0)
      const timeoutFrac = lost / buckets
      const lossFrac =
        ping.probes.reduce((t, p) => t + (p.loss / 100) * p.values.length, 0) / buckets
      const bad = Math.min(1, Math.max(0, 0.5 * timeoutFrac + 0.5 * lossFrac))
      probeGot = Math.round(25 * (1 - bad))
      probeNote = `丢包 ${Math.round(lossFrac * 1000) / 10}% · 超时桶 ${Math.round(timeoutFrac * 1000) / 10}%`
    }
  }
  const probeInsufficient = probeGot === null
  const probe: HealthPart = {
    key: "probe",
    label: "探测",
    got: probeGot ?? 0,
    max: 25,
    note: probeInsufficient ? "探测数据不足" : probeNote,
  }

  const parts = [online, resource, expiry, probe]
  const total = probeInsufficient
    ? Math.round(((onlineGot + resourceGot + expiryGot) / 75) * 100)
    : onlineGot + resourceGot + expiryGot + (probeGot ?? 0)
  return { total, grade: gradeOf(total), parts, probeInsufficient }
}
