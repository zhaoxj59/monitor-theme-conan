import { daysOf, monthUsage, priceText } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { percent } from "@/lib/format"
import { availabilityOf, diskForecast, fetchMetricsHistory } from "@/lib/history"

export type Conclusion = {
  kind: "disk" | "traffic" | "availability" | "expiry"
  text: string
  /** Set where the figure is already a problem, not a forecast: colours the row. */
  hot?: boolean
}

/**
 * The traffic period the hub is metering: `month_start` is its first day
 * (a `YYYY-MM-DD` the hub maintains), and the next period opens one
 * calendar month later on the node's reset day. A hub whose stored start
 * does not parse falls back to the most recent reset day, and to the
 * calendar month before that.
 */
function periodOf(node: Node): { start: number; days: number } | null {
  const reset = node.traffic_reset_day >= 1 && node.traffic_reset_day <= 31 ? node.traffic_reset_day : 1
  const at = (y: number, m: number) => new Date(y, m, Math.min(reset, new Date(y, m + 1, 0).getDate())).getTime()
  let start = node.month_start ? new Date(`${node.month_start}T00:00:00`).getTime() : NaN
  if (Number.isNaN(start) || start > Date.now()) {
    const now = new Date()
    start = at(now.getFullYear(), now.getMonth())
    if (start > Date.now()) start = at(now.getFullYear(), now.getMonth() - 1)
  }
  const s = new Date(start)
  const next = at(s.getFullYear(), s.getMonth() + 1)
  const days = (next - start) / 86400000
  return days > 0 ? { start, days } : null
}

/** This period's traffic projected to its end, from the snapshot alone. */
function trafficConclusion(node: Node): Conclusion | null {
  const limit = node.traffic_limit
  if (limit <= 0) return null
  const used = monthUsage(node)
  if (used <= 0) return null
  const period = periodOf(node)
  if (!period) return null
  const elapsedDays = (Date.now() - period.start) / 86400000
  if (elapsedDays < 1) return null
  const projected = (used / elapsedDays) * period.days
  const pct = (projected / limit) * 100
  const shown = pct >= 10 ? `${Math.round(pct)}` : `${Math.round(pct * 10) / 10}`
  return {
    kind: "traffic",
    text: `本月流量预计用到上限的 ${shown}%`,
    hot: pct >= 100 || undefined,
  }
}

/** The expiry reminder, in the card's own price and day-count terms. */
function expiryConclusion(node: Node): Conclusion | null {
  const days = daysOf(node)
  if (days === null || days > 30) return null
  const price = node.price > 0 ? `，续费 ${priceText(node)}` : ""
  return {
    kind: "expiry",
    text: days < 0 ? `已过期 ${-days} 天${price}` : `${days} 天后到期${price}`,
    hot: days <= 7 || undefined,
  }
}

/**
 * Everything the node's history can honestly support, each line carrying
 * the figure it rests on. A claim whose data is missing, too short, or
 * points the other way is left out whole -- the panel renders nothing
 * when the list is empty, so silence never has to be explained.
 * `historyDays` caps the fetch as it caps the detail page's own charts.
 */
export async function conclusionsOf(node: Node, historyDays: number): Promise<Conclusion[]> {
  const out: Conclusion[] = []
  const hours = Math.max(1, Math.min(30, Math.floor(historyDays))) * 24
  const history = await fetchMetricsHistory(node.id, hours)
  if (history) {
    const usedNow = node.metrics?.disk_used ?? history.rows[history.rows.length - 1].disk_used
    const forecast = diskForecast(history, node.disk_total, usedNow)
    if (forecast) {
      const pct = Math.round(percent(usedNow, node.disk_total))
      out.push({
        kind: "disk",
        text: `按近 7 天增速，磁盘约 ${Math.max(1, Math.round(forecast.days))} 天后写满（当前 ${pct}%）`,
        hot: forecast.days <= 14 || undefined,
      })
    }
    const availability = availabilityOf(history)
    if (availability && availability.spanDays >= 7) {
      const span = availability.spanDays >= 29 ? "近 30 天" : `近 ${Math.floor(availability.spanDays)} 天`
      out.push({
        kind: "availability",
        text: `${span}可用率 ${availability.pct.toFixed(1)}%`,
        hot: availability.pct < 95 || undefined,
      })
    }
  }
  const traffic = trafficConclusion(node)
  if (traffic) out.push(traffic)
  const expiry = expiryConclusion(node)
  if (expiry) out.push(expiry)
  return out
}
