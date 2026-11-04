import { useState } from "react"
import { ArrowDown, ArrowUp, ChevronDown, CircleAlert, Coins, Cpu, Gauge, Server } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { monthlyCNY } from "@/lib/cny"
import { abnormal, reasonsOf } from "@/lib/events"
import { bytes, rate } from "@/lib/format"
import { cn } from "@/lib/utils"

function Tile({ icon: Icon, label, children }: {
  icon: typeof Server; label: string; children: React.ReactNode
}) {
  return (
    <Card className="gap-0 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      {children}
    </Card>
  )
}

function Big({ children }: { children: React.ReactNode }) {
  return <div className="tnum mt-1.5 text-lg leading-6 font-semibold">{children}</div>
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="tnum mt-0.5 truncate text-xs text-muted-foreground">{children}</div>
}

/**
 * The abnormal tile: a plain tile while the fleet is healthy, and once any
 * node trips, the whole tile opens a roster of the offenders -- name plus
 * the reason it tripped -- each row jumping straight to that node's page.
 * The panel mirrors the corner style menu: a fixed click-catcher closes it
 * from outside, and it anchors right on small screens (the tile sits in the
 * right-hand column there) and left from md up.
 */
function AbnormalTile({ nodes, onOpen }: { nodes: Node[]; onOpen: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  const bad = nodes.filter(abnormal)
  if (bad.length === 0) {
    return (
      <Tile icon={CircleAlert} label="异常">
        <Big>0 台</Big>
        <Sub>无</Sub>
      </Tile>
    )
  }
  return (
    <div className="relative">
      <Card
        className="h-full cursor-pointer gap-0 p-3 transition-colors hover:bg-accent/50"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-haspopup="true"
        title="查看异常服务器"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleAlert className="size-3.5" />
          异常
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
        </div>
        <Big>{bad.length} 台</Big>
        <Sub>离线 / 高负载 / 临期</Sub>
      </Card>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 z-50 mt-2 max-h-72 w-[min(18rem,80vw)] overflow-y-auto rounded-2xl border border-border bg-card/90 p-1.5 shadow-lg backdrop-blur md:right-auto md:left-0"
            role="menu"
            aria-label="异常服务器"
          >
            {bad.map((n) => (
              <button
                key={n.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onOpen(n.id)
                }}
                className="block w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="block truncate text-[13px] font-medium">{n.name}</span>
                <span className="tnum block truncate text-[11px] text-muted-foreground">
                  {reasonsOf(n).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Summary({ nodes, onOpen }: { nodes: Node[]; onOpen: (id: number) => void }) {
  const online = nodes.filter((n) => n.online)
  const sum = (pick: (n: Node) => number) => nodes.reduce((t, n) => t + pick(n), 0)
  const live = (pick: (n: Node) => number) => online.reduce((t, n) => t + (n.metrics ? pick(n) : 0), 0)
  const monthly = nodes.reduce((t, n) => t + (monthlyCNY(n.price, n.currency, n.billing_cycle) ?? 0), 0)
  // The fleet states the 2.0 layer counted: a node is only "online" here once
  // it is actually reporting; connected-but-silent counts as waiting, the
  // distinction the plain online flag cannot make.
  const reporting = nodes.filter((n) => n.online && n.metrics)
  const waiting = nodes.filter((n) => n.online && !n.metrics).length
  const avgCpu = reporting.length
    ? reporting.reduce((t, n) => t + n.metrics!.cpu, 0) / reporting.length
    : null

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
      <Tile icon={Server} label="节点">
        <Big>{nodes.length} 台</Big>
        <Sub>在线 {reporting.length} · 等待上报 {waiting} · 离线 {nodes.length - online.length}</Sub>
      </Tile>

      <AbnormalTile nodes={nodes} onOpen={onOpen} />

      <Tile icon={Cpu} label="平均 CPU">
        <Big>{avgCpu !== null ? `${avgCpu.toFixed(1)}%` : "—"}</Big>
        <Sub>{reporting.length ? `基于 ${reporting.length} 台有效上报` : "暂无有效上报"}</Sub>
      </Tile>

      <Tile icon={Gauge} label="实时总速率">
        <div className="tnum mt-1.5 space-y-0.5 text-sm font-semibold">
          <div className="flex items-center gap-1">
            <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
            {rate(live((n) => n.metrics!.net_rx))}
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
            {rate(live((n) => n.metrics!.net_tx))}
          </div>
        </div>
      </Tile>

      <Tile icon={ArrowDown} label="本月总流量">
        <div className="tnum mt-1.5 space-y-0.5 text-sm font-semibold">
          <div className="flex items-center gap-1">
            <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
            {bytes(sum((n) => n.month_rx))}
          </div>
          <div className="flex items-center gap-1">
            <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
            {bytes(sum((n) => n.month_tx))}
          </div>
        </div>
        <Sub>累计 ↓ {bytes(sum((n) => n.total_rx))} · ↑ {bytes(sum((n) => n.total_tx))}</Sub>
      </Tile>

      <Tile icon={Coins} label="续费合计">
        <Big>{monthly > 0 ? `¥${Math.round(monthly)}` : "—"}</Big>
        <Sub>{monthly > 0 ? "折合每月 · 人民币" : "未设置价格"}</Sub>
      </Tile>
    </div>
  )
}
