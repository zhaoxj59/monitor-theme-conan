import { useEffect, useState, useSyncExternalStore } from "react"

import { Card } from "@/components/ui/card"
import { EVENT_DOT } from "@/components/EventLog"
import { HeatWall } from "@/components/HeatWall"
import { Country } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { abnormal, getEvents, reasonsOf, subscribeEvents } from "@/lib/events"
import { percent } from "@/lib/format"
import { probeNow, usePing } from "@/lib/ping"
import { CELL_COLORS } from "@/components/Cells"
import { cn } from "@/lib/utils"

const BAR_GRADIENT = "linear-gradient(90deg, #3578e5, #2dd4bf)"

const pad = (v: number) => String(v).padStart(2, "0")

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

function MiniBar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="flex items-center gap-1.5 leading-none">
      <span className="w-6 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-(--track)">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct === null ? 0 : Math.min(100, Math.max(0, pct))}%`, background: BAR_GRADIENT }}
        />
      </div>
      <span className="tnum w-8 shrink-0 text-right text-[10px]">
        {pct === null ? "—" : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}

/**
 * One matrix cell: identity and live load at a glance, plus the node's
 * representative latency -- the median probe's own current reading, in
 * that probe's baseline colours, from the same window the cards draw.
 */
function MatrixCell({ node, onOpen }: { node: Node; onOpen: (id: number) => void }) {
  const ping = usePing(node.id, 6, 24)
  const m = node.metrics
  const answered = (ping?.probes ?? [])
    .map(probeNow)
    .filter((n): n is Extract<ReturnType<typeof probeNow>, { timeout: false }> => !n.timeout)
  const rep = answered.length
    ? answered.sort((a, b) => a.v - b.v)[Math.floor(answered.length / 2)]
    : null
  return (
    <button
      type="button"
      onClick={() => onOpen(node.id)}
      className="min-w-0 rounded-xl border border-border bg-card/40 p-1.5 text-left transition-colors hover:border-(--frame-hover)"
    >
      <div className="flex items-center gap-1.5">
        <Country node={node} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={node.name}>{node.name}</span>
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            node.online ? (m ? "bg-online" : "bg-(--tone-warn)") : "bg-offline",
          )}
        />
      </div>
      {m ? (
        <div className="mt-1 space-y-0.5">
          <MiniBar label="CPU" pct={m.cpu} />
          <MiniBar label="内存" pct={percent(m.mem_used, m.mem_total)} />
          <MiniBar label="磁盘" pct={percent(m.disk_used, m.disk_total)} />
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground">{node.online ? "等待上报" : "离线"}</p>
      )}
      <div className="tnum mt-1 text-[10px] text-muted-foreground">
        延迟{" "}
        {ping === undefined ? (
          "…"
        ) : !node.online ? (
          <span style={{ color: CELL_COLORS.lost }}>离线</span>
        ) : rep ? (
          <span style={{ color: CELL_COLORS[rep.cls] }}>{Math.round(rep.v)} ms</span>
        ) : ping && ping.probes.length > 0 ? (
          <span style={{ color: CELL_COLORS.lost }}>超时</span>
        ) : (
          "—"
        )}
      </div>
    </button>
  )
}

/**
 * The command centre: one screen for a second display -- every node as a
 * matrix cell, the probe heat wall under it full-width, the abnormal
 * roster and the newest case-log entries beside them, under a live
 * clock. It reads nothing the case wall does not already read: the same
 * stream, the same cached ping windows, the same stored log.
 */
export function CommandCenter({ nodes, onOpen, showHeatmap }: {
  nodes: Node[]
  onOpen: (id: number) => void
  showHeatmap: boolean
}) {
  const now = useClock()
  const events = useSyncExternalStore(subscribeEvents, getEvents)
  const online = nodes.filter((n) => n.online).length
  const bad = nodes.filter(abnormal)
  return (
    <div className="flex flex-col gap-2 xl:h-[calc(100svh-7.5rem)]">
      {/* A status strip, not a card of its own: `flex-row` is load-bearing --
          the Card shell is flex-col, and without it the four readings stack
          into a tall centred column instead of one line. */}
      <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-2">
        <span className="tnum text-base font-semibold tracking-wider sm:text-lg">
          {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
        </span>
        <span className="text-xs text-muted-foreground">
          {now.getMonth() + 1} 月 {now.getDate()} 日
        </span>
        <span className="tnum text-xs sm:text-sm">
          在线 <b>{online} / {nodes.length}</b>
        </span>
        <span className="tnum text-xs sm:text-sm">
          异常 <b style={{ color: bad.length ? "var(--tone-hot)" : undefined }}>{bad.length}</b>
        </span>
        <span className="ml-auto hidden text-xs tracking-[0.14em] text-muted-foreground sm:block">真相只有一个</span>
      </Card>

      {/* The single column below lg is spelled minmax(0, 1fr), never left
          implicit: an auto-sized track takes the widest item's min-content,
          and one wide descendant (an event row whose text cannot wrap) would
          stretch the track past the screen and take the whole page with it.
          min-w-0 on every item keeps that chain broken at the item level too. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)_auto] xl:items-stretch">
        <Card className="min-w-0 gap-0 p-2 sm:p-3 lg:col-start-1 lg:row-start-1 xl:min-h-0 xl:overflow-y-auto">
          <h3 className="mb-1.5 text-[13px] font-medium">全节点状态矩阵</h3>
          {nodes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">还没有节点</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:gap-2 xl:grid-cols-3">
              {nodes.map((n) => (
                <MatrixCell key={n.id} node={n} onOpen={onOpen} />
              ))}
            </div>
          )}
        </Card>

        {showHeatmap && (
          <div className="min-w-0 lg:col-span-2 lg:row-start-2">
            <HeatWall nodes={nodes} onOpen={onOpen} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-1 xl:min-h-0">
          <Card className="gap-0 p-2 sm:p-3 xl:shrink-0">
            <h3 className="mb-1 text-[13px] font-medium">异常</h3>
            {bad.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">无异常</p>
            ) : (
              <div>
                {bad.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onOpen(n.id)}
                    className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="block truncate text-[13px] font-medium">{n.name}</span>
                    <span className="tnum block truncate text-[11px] text-muted-foreground">
                      {reasonsOf(n).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="gap-0 p-2 sm:p-3 xl:min-h-0 xl:flex-1">
            <h3 className="mb-1 text-[13px] font-medium">案件记录 · 最新</h3>
            {events.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">暂无记录</p>
            ) : (
              <ol className="max-h-72 overflow-y-auto pr-1 xl:max-h-none xl:min-h-0 xl:flex-1">
                {events.slice(0, 20).map((e, i) => (
                  <li
                    key={`${e.t}:${e.id}:${e.kind}:${i}`}
                    className="flex items-center gap-2 border-t border-border/50 py-1.5 text-[13px] first:border-t-0"
                  >
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: EVENT_DOT[e.kind] }} />
                    <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                      {pad(new Date(e.t).getHours())}:{pad(new Date(e.t).getMinutes())}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpen(e.id)}
                      className="max-w-28 shrink-0 truncate font-medium transition-opacity hover:opacity-70"
                    >
                      {e.name}
                    </button>
                    <span className="min-w-0 truncate text-muted-foreground">{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
