import { useState } from "react"
import { Check, Copy, Download, FileText, X } from "lucide-react"

import { Card } from "@/components/ui/card"
import { daysOf, monthUsage } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { monthlyCNY } from "@/lib/cny"
import { abnormal, getEvents, reasonsOf, type EventKind } from "@/lib/events"
import { bytes } from "@/lib/format"
import { availabilityOf, fetchMetricsHistory } from "@/lib/history"

type AvailRow = { name: string; pct: number | null; spanDays: number; note?: string }

type ReportData = {
  title: string
  until: string
  total: number
  online: number
  bad: { name: string; reasons: string }[]
  trafficRx: number
  trafficTx: number
  top: { name: string; used: number }[]
  availability: AvailRow[]
  expiring: { name: string; text: string }[]
  eventsTotal: number
  eventsByKind: [string, number][]
  monthlyCost: number
}

const KIND_LABEL: Record<EventKind, string> = {
  offline: "离线",
  online: "恢复上线",
  waiting: "等待上报",
  reporting: "恢复上报",
  abnormal: "进入异常",
  resolved: "异常解除",
}

/** The report's lines, shared by the panel, the clipboard and the file. */
function buildText(d: ReportData, md: boolean): string {
  const h = (s: string) => (md ? `## ${s}` : s)
  const li = (s: string) => (md ? `- ${s}` : `· ${s}`)
  const lines: string[] = [
    md ? `# ${d.title}` : d.title,
    d.until,
    "",
    h("节点总览"),
    li(`共 ${d.total} 台 · 在线 ${d.online} · 异常 ${d.bad.length}`),
    ...(d.bad.length
      ? d.bad.map((b) => li(`${b.name}：${b.reasons}`))
      : [li("异常：无")]),
    "",
    h("本月流量（当前计费周期）"),
    li(`全网 ↓ ${bytes(d.trafficRx)} · ↑ ${bytes(d.trafficTx)} · 合计 ${bytes(d.trafficRx + d.trafficTx)}`),
    ...d.top.map((t, i) => li(`TOP${i + 1} ${t.name}：${bytes(t.used)}`)),
    "",
    h("各节点可用率（历史窗口）"),
    ...d.availability.map((a) =>
      li(a.pct === null ? `${a.name}：${a.note ?? "数据不足"}` : `${a.name}：${a.pct.toFixed(1)}%（近 ${Math.floor(a.spanDays)} 天）`),
    ),
    "",
    h("本月到期 / 已到期"),
    ...(d.expiring.length ? d.expiring.map((e) => li(`${e.name}：${e.text}`)) : [li("无")]),
    "",
    h("案件记录（本浏览器记录）"),
    li(
      d.eventsTotal === 0
        ? "本月无记录"
        : `本月共 ${d.eventsTotal} 条` +
            (d.eventsByKind.length ? ` · ${d.eventsByKind.map(([k, n]) => `${k} ${n}`).join(" · ")}` : ""),
    ),
    li("注：案件记录保存在本浏览器本地，仅覆盖页面开启时段"),
    "",
    li(d.monthlyCost > 0 ? `续费合计：¥${Math.round(d.monthlyCost)}/月（折合人民币）` : "续费合计：未设置价格"),
  ]
  return lines.join("\n")
}

/**
 * The month's case file, assembled on demand: the snapshot's own figures
 * directly, and one history read per node for its availability -- walked
 * behind a progress count, with a node that fails marked rather than
 * allowed to sink the whole report. Nothing in it is estimated: a figure
 * the data cannot carry is printed as 数据不足.
 */
export function MonthReport({ nodes, historyDays, siteName }: {
  nodes: Node[]
  historyDays: number
  siteName: string
}) {
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [done, setDone] = useState(0)
  const [report, setReport] = useState<ReportData | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    setOpen(true)
    setWorking(true)
    setReport(null)
    setCopied(false)
    setDone(0)
    const now = new Date()
    const hours = Math.max(1, Math.min(30, Math.floor(historyDays))) * 24
    let finished = 0
    const availability = await Promise.all(
      nodes.map(async (n): Promise<AvailRow> => {
        const history = await fetchMetricsHistory(n.id, hours)
        finished++
        setDone(finished)
        if (!history) return { name: n.name, pct: null, spanDays: 0, note: "获取失败" }
        const a = availabilityOf(history)
        if (!a || a.spanDays < 7) return { name: n.name, pct: null, spanDays: a?.spanDays ?? 0, note: "数据不足" }
        return { name: n.name, pct: a.pct, spanDays: a.spanDays }
      }),
    )
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const monthEvents = getEvents().filter((e) => e.t >= monthStart)
    const byKind = new Map<string, number>()
    for (const e of monthEvents) byKind.set(KIND_LABEL[e.kind], (byKind.get(KIND_LABEL[e.kind]) ?? 0) + 1)
    const expiring = nodes
      .map((n) => {
        const days = daysOf(n)
        if (days === null || !n.expires_at) return null
        const at = new Date(`${n.expires_at}T00:00:00`)
        const thisMonth = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()
        if (days < 0) return { name: n.name, text: `${n.expires_at} 到期 · 已过期 ${-days} 天`, days }
        if (thisMonth) return { name: n.name, text: `${n.expires_at} 到期 · 剩 ${days} 天`, days }
        return null
      })
      .filter((e): e is { name: string; text: string; days: number } => e !== null)
      .sort((a, b) => a.days - b.days)
    setReport({
      title: `月度案件报告 · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
      until: `${siteName ? `${siteName} · ` : ""}截至 ${now.getMonth() + 1} 月 ${now.getDate()} 日`,
      total: nodes.length,
      online: nodes.filter((n) => n.online).length,
      bad: nodes.filter(abnormal).map((n) => ({ name: n.name, reasons: reasonsOf(n).join(" · ") })),
      trafficRx: nodes.reduce((t, n) => t + n.month_rx, 0),
      trafficTx: nodes.reduce((t, n) => t + n.month_tx, 0),
      top: nodes
        .map((n) => ({ name: n.name, used: monthUsage(n) }))
        .filter((t) => t.used > 0)
        .sort((a, b) => b.used - a.used)
        .slice(0, 3),
      availability,
      expiring,
      eventsTotal: monthEvents.length,
      eventsByKind: [...byKind.entries()],
      monthlyCost: nodes.reduce((t, n) => t + (monthlyCNY(n.price, n.currency, n.billing_cycle) ?? 0), 0),
    })
    setWorking(false)
  }

  const copy = async () => {
    if (!report) return
    const text = buildText(report, false)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      document.body.append(area)
      area.select()
      document.execCommand("copy")
      area.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    if (!report) return
    const now = new Date()
    const blob = new Blob([buildText(report, true)], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `月度案件报告-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={generate}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs backdrop-blur transition-colors hover:bg-card/90"
        >
          <FileText className="size-3.5" />
          本月报告
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-background/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <Card
            className="max-h-[85vh] w-full max-w-2xl gap-0 overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">{report?.title ?? "月度案件报告"}</h3>
                {report && <p className="mt-0.5 text-xs text-muted-foreground">{report.until}</p>}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="rounded-full border border-border p-1.5 transition-colors hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            {working ? (
              <p className="tnum py-10 text-center text-sm text-muted-foreground">
                正在生成… 已完成 {done} / {nodes.length} 台
              </p>
            ) : report ? (
              <div className="mt-3 space-y-4 text-sm">
                <section>
                  <h4 className="mb-1 text-[13px] font-medium">节点总览</h4>
                  <p className="tnum">
                    共 {report.total} 台 · 在线 {report.online} · 异常 {report.bad.length}
                    {report.monthlyCost > 0 && <> · 续费合计 ¥{Math.round(report.monthlyCost)}/月</>}
                  </p>
                  {report.bad.map((b) => (
                    <p key={b.name} className="tnum mt-0.5 text-muted-foreground">
                      {b.name}：{b.reasons}
                    </p>
                  ))}
                </section>
                <section>
                  <h4 className="mb-1 text-[13px] font-medium">本月流量（当前计费周期）</h4>
                  <p className="tnum">
                    全网 ↓ {bytes(report.trafficRx)} · ↑ {bytes(report.trafficTx)} · 合计{" "}
                    {bytes(report.trafficRx + report.trafficTx)}
                  </p>
                  {report.top.map((t, i) => (
                    <p key={t.name} className="tnum mt-0.5 text-muted-foreground">
                      TOP{i + 1} {t.name}：{bytes(t.used)}
                    </p>
                  ))}
                </section>
                <section>
                  <h4 className="mb-1 text-[13px] font-medium">各节点可用率（历史窗口）</h4>
                  {report.availability.map((a) => (
                    <p key={a.name} className="tnum mt-0.5 flex justify-between gap-2">
                      <span className="min-w-0 truncate">{a.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {a.pct === null ? (a.note ?? "数据不足") : `${a.pct.toFixed(1)}%（近 ${Math.floor(a.spanDays)} 天）`}
                      </span>
                    </p>
                  ))}
                </section>
                <section>
                  <h4 className="mb-1 text-[13px] font-medium">本月到期 / 已到期</h4>
                  {report.expiring.length === 0 ? (
                    <p className="text-muted-foreground">无</p>
                  ) : (
                    report.expiring.map((e) => (
                      <p key={e.name} className="tnum mt-0.5 text-muted-foreground">
                        {e.name}：{e.text}
                      </p>
                    ))
                  )}
                </section>
                <section>
                  <h4 className="mb-1 text-[13px] font-medium">案件记录（本浏览器记录）</h4>
                  <p className="tnum">
                    {report.eventsTotal === 0
                      ? "本月无记录"
                      : `本月共 ${report.eventsTotal} 条${report.eventsByKind.length ? ` · ${report.eventsByKind.map(([k, n]) => `${k} ${n}`).join(" · ")}` : ""}`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    注：案件记录保存在本浏览器本地，仅覆盖页面开启时段
                  </p>
                </section>
                <div className="flex gap-2 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={copy}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "已复制" : "复制为文本"}
                  </button>
                  <button
                    type="button"
                    onClick={download}
                    className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                  >
                    <Download className="size-3.5" />
                    下载 Markdown
                  </button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </>
  )
}
