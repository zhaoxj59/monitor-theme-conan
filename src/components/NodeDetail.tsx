import { useEffect, useMemo, useState } from "react"
import { ArrowLeft } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Conclusions } from "@/components/Conclusions"
import { HealthPanel } from "@/components/Health"
import { Country, Status } from "@/components/NodeCard"
import { CELL_COLORS, ResCells, StatusCells, fillCells } from "@/components/Cells"
import { api, type Node } from "@/lib/api"
import { probeCells, probeNow, usePing } from "@/lib/ping"
import { bytes, cpuName, osName, percent, uptime, windows } from "@/lib/format"
import { cn } from "@/lib/utils"

type Point = { ts: number; cpu: number; mem_used: number }

function Fact({ label, value, className, wrap }: { label: string; value?: React.ReactNode; className?: string; wrap?: boolean }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn("tnum leading-5", wrap ? "text-xs break-all" : "truncate text-[13px]")}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 p-3">
      <h3 className="mb-2 text-[13px] font-medium">{title}</h3>
      {children}
    </Card>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/** Whole-window loss as printed: whole numbers trimmed, a trace of loss as <1. */
function fmtLoss(loss: number): string {
  if (loss <= 0) return "0"
  return loss < 1 ? "<1" : `${Math.round(loss * 10) / 10}`.replace(/\.0$/, "")
}

function Stats({ values, unit }: { values: number[]; unit: string }) {
  if (!values.length) return null
  const last = values[values.length - 1]
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const max = Math.max(...values)
  const f = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}${unit}`
  return (
    <div className="tnum mb-1.5 flex gap-4 text-xs text-muted-foreground">
      <span>当前 <span className="text-foreground">{f(last)}</span></span>
      <span>平均 <span className="text-foreground">{f(avg)}</span></span>
      <span>最高 <span className="text-foreground">{f(max)}</span></span>
    </div>
  )
}

export function NodeDetail({ node, historyDays, onBack }: {
  node: Node
  historyDays: number
  onBack: () => void
}) {
  const ranges = useMemo(() => windows(historyDays), [historyDays])
  const [hours, setHours] = useState(() => {
    const all = windows(historyDays)
    return all.find((r) => r.hours === 24)?.hours ?? all[all.length - 1].hours
  })
  const [points, setPoints] = useState<Point[] | null>(null)
  const [failed, setFailed] = useState("")
  const [attempt, setAttempt] = useState(0)
  const ping = usePing(node.id, hours, 48)

  useEffect(() => {
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect
    setPoints(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    api<{ metrics: Point[] }>(`/nodes/${node.id}/metrics?hours=${hours}&points=240&series=metrics`)
      .then((d) => {
        if (active) setPoints(d.metrics)
      })
      .catch((e: Error) => {
        if (active) {
          setFailed(e.message)
          setPoints([])
        }
      })
    return () => {
      active = false
    }
  }, [node.id, hours, attempt])

  const m = node.metrics
  const cpuValues = useMemo(() => (points ?? []).map((p) => p.cpu), [points])
  const memValues = useMemo(
    () => (points ?? []).map((p) => (node.mem_total > 0 ? (p.mem_used / node.mem_total) * 100 : 0)),
    [points, node.mem_total],
  )
  const cpuNow = m ? m.cpu : (cpuValues[cpuValues.length - 1] ?? 0)
  const memNow = m ? percent(m.mem_used, m.mem_total) : (memValues[memValues.length - 1] ?? 0)

  return (
    <div className="space-y-2.5">
      <div className="sticky top-3 z-20">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-sm shadow-sm backdrop-blur transition-colors hover:border-ring"
        >
          <ArrowLeft className="size-4" />
          返回
        </button>
      </div>

      {/* The case banner: the deduction artwork spans the top of every
          node's file, whichever style is in force, and the name and
          status ride the picture's foot under a `--background` wash, the
          same tokens the home header's portrait cell is edged with. The
          art (1440x1050) is nearly square against a wide banner, so cover
          binds on the width and the only say is which horizontal band
          shows: at 110/160px that band was a sixth of the picture and cut
          every suspect card and most of Shinichi. The banner now stands
          150/320px and the band rides higher -- on a phone (328px wide,
          picture rendered ~239px tall) it takes in y 5%-68%, every card
          and Shinichi's face whole; on a wide screen (~1352px, picture
          ~986px tall) y 23%-55%, the middle cards and his eyes and mouth,
          the top and bottom cards the price of a banner that stays one. */}
      <div className="relative h-[150px] overflow-hidden rounded-2xl border border-border sm:h-[320px]">
        <img
          src="/assets/header-detail.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[50%_14%] sm:object-[50%_34%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-2 gap-y-1 p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-2">
            <Country node={node} />
            <h2 className="truncate text-base font-medium sm:text-lg" title={node.name}>{node.name}</h2>
          </div>
          <Status node={node} />
          {node.agent_version && <Badge className="font-normal">agent {node.agent_version}</Badge>}
        </div>
      </div>

      <Conclusions node={node} historyDays={historyDays} />

      <HealthPanel node={node} />

      <Panel title="概览">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-4">
          <Fact label="状态" value={node.online ? "在线" : "离线"} />
          <Fact label="国家 / 地区" value={node.country || "—"} />
          <Fact label="系统" value={osName(node.os)} />
          <Fact wrap label="内核" value={node.kernel} />
          <Fact label="架构" value={node.arch} />
          <Fact label="虚拟化" value={node.virt && node.virt !== "none" ? node.virt : "—"} />
          <Fact label="Agent" value={node.agent_version} />
          <Fact label="在线时长" value={m ? uptime(m.uptime) : "—"} />
        </dl>
      </Panel>

      <div className="flex flex-wrap gap-1">
        {ranges.map((r) => (
          <Tab key={r.hours} active={hours === r.hours} onClick={() => setHours(r.hours)}>
            {r.label}
          </Tab>
        ))}
      </div>

      {failed ? (
        <p className="py-5 text-center text-sm text-destructive" role="alert">
          读取历史数据失败：{failed}
          <button className="ml-2 underline" onClick={() => setAttempt((n) => n + 1)}>重试</button>
        </p>
      ) : points === null ? (
        <Skeleton className="h-40 w-full" />
      ) : points.length === 0 ? (
        <p className="py-5 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="grid items-start gap-2.5 lg:grid-cols-2">
          <Panel title="CPU">
            <Stats values={cpuValues} unit="%" />
            <ResCells cells={fillCells(cpuNow, 48)} />
          </Panel>
          <Panel title={`内存 · ${bytes(node.mem_total)}`}>
            <Stats values={memValues} unit="%" />
            <ResCells cells={fillCells(memNow, 48)} />
          </Panel>
        </div>
      )}

      <Panel title="磁盘">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{bytes(node.disk_total)}</span>
          <span className="tnum">
            {m
              ? `已用 ${Math.round(percent(m.disk_used, m.disk_total))}% · 剩 ${bytes(m.disk_total - m.disk_used)}`
              : "—"}
          </span>
        </div>
        <div className="mt-1">
          <ResCells cells={fillCells(m ? percent(m.disk_used, m.disk_total) : 0, 48)} />
        </div>
      </Panel>

      <Panel title="延迟">
        {ping === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : ping === null || ping.probes.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
        ) : (
          <div className="space-y-2">
            {ping.probes.map((p) => {
              const now = probeNow(p)
              return (
                <div key={p.id}>
                  <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{p.name}</span>
                    <span className="tnum shrink-0">
                      {!node.online || now.timeout ? (
                        <span style={{ color: CELL_COLORS.lost }}>超时</span>
                      ) : (
                        <>
                          <span style={{ color: CELL_COLORS[now.cls] }}>{Math.round(now.v)} ms</span>
                          <span className="text-muted-foreground"> · 丢包 {fmtLoss(p.loss)}%</span>
                        </>
                      )}
                    </span>
                  </div>
                  <StatusCells cells={probeCells(p, 48)} offline={!node.online} />
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel title="系统档案">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact className="col-span-2" label="CPU" value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`} />
          <Fact label="内存" value={bytes(node.mem_total)} />
          <Fact label="磁盘" value={bytes(node.disk_total)} />
          <Fact label="Swap" value={node.swap_total > 0 ? bytes(node.swap_total) : "—"} />
          <Fact label="TCP 连接" value={m ? m.tcp : "—"} />
          <Fact label="UDP 套接字" value={m ? m.udp : "—"} />
          <Fact label="进程数" value={m ? m.procs : "—"} />
          <Fact label="累计流量" value={`↓ ${bytes(node.total_rx)} · ↑ ${bytes(node.total_tx)}`} />
          <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
          <Fact label="负载" value={m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"} />
        </dl>
      </Panel>

      <HistoryPanel key={node.id} node={node} />
    </div>
  )
}

/** One on-demand history series: the layer's plain polyline, 0-based to at least 100%. */
function HistoryChart({ values, label }: { values: number[]; label: string }) {
  if (!values.length) {
    return (
      <div>
        <div className="mb-1 text-xs text-muted-foreground">{label}</div>
        <p className="py-2 text-xs text-muted-foreground">暂无历史数据</p>
      </div>
    )
  }
  const w = 520
  const h = 70
  const p = 4
  const max = Math.max(100, ...values)
  const pts = values
    .map((v, i) => `${p + (i / Math.max(1, values.length - 1)) * (w - 2 * p)},${h - p - (v / max) * (h - 2 * p)}`)
    .join(" ")
  return (
    <div>
      <div className="tnum mb-1 text-xs text-muted-foreground">
        {label} · 当前 {values[values.length - 1].toFixed(1)}%
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-[70px] w-full" role="img" aria-label={`${label}历史曲线`}>
        <polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/**
 * The last 24 hours of CPU and memory, fetched only when asked: the panel
 * mounts idle and reads nothing, the first展开 issues the one request, and
 * afterwards the button merely folds the charts away and back. Nothing here
 * polls -- the live figures above already update on their own.
 */
function HistoryPanel({ node }: { node: Node }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle")
  const [open, setOpen] = useState(false)
  const [series, setSeries] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] })
  const [error, setError] = useState("")

  const load = () => {
    setState("loading")
    api<{ metrics: { cpu?: number; mem_used?: number }[] }>(`/nodes/${node.id}/metrics?hours=24&series=metrics`)
      .then((d) => {
        const rows = Array.isArray(d.metrics) ? d.metrics : []
        const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)
        setSeries({
          cpu: rows.map((r) => num(r.cpu)).filter((v): v is number => v !== null),
          mem: rows
            .map((r) => {
              const used = num(r.mem_used)
              return used !== null && node.mem_total > 0 ? (used / node.mem_total) * 100 : null
            })
            .filter((v): v is number => v !== null),
        })
        setState("ready")
        setOpen(true)
      })
      .catch((e: Error) => {
        setError(e.message)
        setState("error")
      })
  }

  return (
    <Panel title="历史性能">
      <div className="flex items-center gap-2">
        {state === "ready" ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
          >
            {open ? "收起历史分析" : "展开历史分析"}
          </button>
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={state === "loading"}
            className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-60"
          >
            {state === "loading" ? "正在读取历史…" : state === "error" ? "重试历史分析" : "历史性能分析"}
          </button>
        )}
        <span className="text-xs text-muted-foreground">最近 24 小时</span>
      </div>
      {state === "error" && (
        <p className="pt-2 text-xs text-destructive" role="alert">{error}</p>
      )}
      {state === "ready" && open && (
        <div className="space-y-3 pt-3">
          <HistoryChart values={series.cpu} label="CPU 使用率" />
          <HistoryChart values={series.mem} label="内存使用率" />
        </div>
      )}
    </Panel>
  )
}
