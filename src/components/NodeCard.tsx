import { useState, type CSSProperties, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { HealthBadge } from "@/components/Health"
import { CELL_COLORS, StatusCells } from "@/components/Cells"
import { DECOS } from "@/components/Decos"
import type { Metrics, Node } from "@/lib/api"
import { toCNY, cycleMonths } from "@/lib/cny"
import { probeCells, probeNow, timeoutCells, usePing, type ProbeSeries } from "@/lib/ping"
import { bytes, daysUntil, money, osName, pair, percent, rate, sinceSeen, uptime } from "@/lib/format"
import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 265. vite.config.ts keeps them from being inlined
// into the bundle as data URLs.
const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/country-flag-icons/3x2/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/** This period's usage as the plan meters it, from the hub's own figure when it sends one. */
export function monthUsage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Status({ node, bare = false }: { node: Node; bare?: boolean }) {
  const down = sinceSeen(node)
  // `bare` drops the duration the full badge carries: the card's header
  // wears it beside a running-time tile that already says how long.
  const label = bare
    ? node.online
      ? "在线"
      : deployed(node)
        ? "离线"
        : "未接入"
    : node.online
      ? `在线 ${node.metrics ? uptime(node.metrics.uptime) : ""}`
      : deployed(node)
        ? `离线 ${down >= 60 ? uptime(down) : ""}`
        : "未接入"
  return (
    <Badge className={cn("tnum shrink-0 gap-1.5 font-normal", !node.online && "text-muted-foreground")}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          node.online ? "bg-online" : deployed(node) ? "bg-offline" : "bg-muted-foreground/40",
        )}
      />
      {label.trim()}
    </Badge>
  )
}

/** Where the machine is: its flag, or the bare code for one the set lacks. */
export function Country({ node }: { node: Node }) {
  if (!node.country) return null
  const src = FLAGS[node.country]
  if (!src) {
    return (
      <Badge className="shrink-0 font-normal text-muted-foreground">
        {node.country}
      </Badge>
    )
  }
  return (
    <img
      src={src}
      alt={node.country}
      title={node.country}
      className="h-3 w-4.5 shrink-0 rounded-[2px] ring-1 ring-foreground/10"
    />
  )
}

/**
 * The flag as the card's header wears it: a rounded block at the name's
 * left, the flag filling it, or the bare code centred for a country the
 * set lacks.
 */
function FlagBlock({ node }: { node: Node }) {
  const src = node.country ? FLAGS[node.country] : undefined
  return (
    <div className="h-10 w-[52px] shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/10">
      {src ? (
        <img src={src} alt={node.country} title={node.country} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-foreground/[0.06] text-xs font-semibold text-muted-foreground">
          {node.country || "—"}
        </div>
      )}
    </div>
  )
}

function OsIcon({ os }: { os: string }) {
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className="size-3 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]"
    >
      <title>{osName(os)}</title>
      <path d={icon.path} />
    </svg>
  )
}

/** Days to expiry on the hub's count where it sends one, else the browser's. */
export function daysOf(node: Node): number | null {
  return node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
}

/** Urgency of a day count: red within a month (or past), amber within a quarter, green beyond. */
export function dayColor(days: number | null): string | undefined {
  if (days === null) return undefined
  return days <= 30 ? "var(--tone-hot)" : days <= 90 ? "var(--tone-warn)" : "var(--tone-ok)"
}

export function daysText(days: number | null): string {
  if (days === null) return "长期"
  return days < 0 ? `过期 ${-days} 天` : `剩 ${days} 天`
}

/** The card's price: whole yuan where a rate exists, the original currency otherwise. */
export function priceText(node: Node): string {
  if (node.price <= 0) return "—"
  const yuan = toCNY(node.price, node.currency)
  if (yuan === null) return money(node.price, node.currency)
  const months = cycleMonths(node.billing_cycle)
  const suffix = months === 1 ? "/月" : months === 12 ? "/年" : months ? `/${months}个月` : ""
  return `¥${Math.round(yuan)}${suffix}`
}

function lossText(loss: number): string {
  return loss > 0 ? ` · 丢 ${loss < 1 ? "<1" : Math.round(loss)}%` : ""
}

function ProbeRow({ probe, offline }: { probe: ProbeSeries; offline: boolean }) {
  const now = probeNow(probe)
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{probe.name}</span>
        <span className="tnum shrink-0">
          {offline || now.timeout ? (
            <span style={{ color: CELL_COLORS.lost }}>超时</span>
          ) : (
            <>
              <span style={{ color: CELL_COLORS[now.cls] }}>{Math.round(now.v)} ms</span>
              <span className="text-muted-foreground">{lossText(probe.loss)}</span>
            </>
          )}
        </span>
      </div>
      <StatusCells cells={probeCells(probe, 24)} offline={offline} />
    </div>
  )
}

/**
 * The card's latency section: one status strip per probe, three shown with the
 * rest behind a toggle. A failed fetch hides the section entirely -- a card
 * must not claim a latency it never measured.
 */
function Latency({ node }: { node: Node }) {
  const ping = usePing(node.id, 6, 24)
  const [expanded, setExpanded] = useState(false)
  const probes = ping?.probes ?? []
  const shown = expanded ? probes : probes.slice(0, 3)
  if (ping !== undefined && probes.length === 0 && node.online) return null
  return (
    <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-1.5">
      {ping === undefined ? (
        <div className="space-y-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[30px] animate-pulse rounded bg-foreground/5" />
          ))}
        </div>
      ) : probes.length === 0 ? (
        node.online ? null : (
          <div>
            <div className="mb-1 text-xs" style={{ color: CELL_COLORS.lost }}>超时</div>
            <StatusCells cells={timeoutCells(24)} />
          </div>
        )
      ) : (
        <>
          {shown.map((p) => (
            <ProbeRow key={p.id} probe={p} offline={!node.online} />
          ))}
          {probes.length > 3 && (
            <button
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((v) => !v)
              }}
            >
              {expanded ? "收起" : `全部 ${probes.length} 个探测`}
              <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

function pctText(pct: number | null): string {
  return pct === null ? "—" : `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`
}

/**
 * A resource as the borrowed archive layout draws it: name and a bold
 * percentage over a thin bar filled blue-to-cyan. The gradient is that
 * layout's signature and stays in every style, like the bowtie's red; the
 * segmented strips it replaces on the card remain on the detail page.
 */
const BAR_GRADIENT = "linear-gradient(90deg, #3578e5, #2dd4bf)"

function GradBar({ label, pct, sub }: { label: string; pct: number | null; sub?: ReactNode }) {
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="tnum text-[13px] font-bold">{pctText(pct)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--track)">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${filled}%`, background: BAR_GRADIENT }}
        />
      </div>
      {sub !== undefined && (
        <div className="tnum mt-1 truncate text-[10px] leading-3 text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}

/**
 * One of the card's data tiles: a quiet block, the label small above and
 * the figure bold below. Figures are set to fit their third of a card at
 * full width -- nothing in a tile truncates to an ellipsis the way the
 * borrowed layout's own load line did.
 */
function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-2 py-1">
      <div className="truncate text-[11px] leading-4 text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 text-[15px] leading-5 font-semibold">{children}</div>
    </div>
  )
}

/** Uptime at tile width: the detail page's "8 天 19 小时" is too wide for a third of a card. */
export function shortUptime(seconds: number): string {
  if (!seconds) return "—"
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const min = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d}天 ${h}小时` : h > 0 ? `${h}小时 ${min}分` : `${min}分`
}

function UptimeTile({ m }: { m: Metrics | null }) {
  return <Tile label="运行时间">{m ? shortUptime(m.uptime) : "—"}</Tile>
}

function NetworkTile({ m }: { m: Metrics | null }) {
  return (
    <Tile label="实时网络">
      <span className="block text-[11px] leading-4 font-medium">
        <span className="block truncate">
          <span className="text-muted-foreground">↓ </span>
          {m ? rate(m.net_rx) : "—"}
        </span>
        <span className="block truncate">
          <span className="text-muted-foreground">↑ </span>
          {m ? rate(m.net_tx) : "—"}
        </span>
      </span>
    </Tile>
  )
}

/** The month tile carries the plan's ceiling the dropped plan section used to print. */
function MonthTile({ node }: { node: Node }) {
  const used = monthUsage(node)
  const limit = node.traffic_limit
  return (
    <Tile label="本月流量">
      <span className="block truncate">{bytes(used)}</span>
      <span className="block truncate text-[10px] leading-3 font-medium text-muted-foreground">
        {limit > 0 ? `/ ${bytes(limit)} · ${Math.round(percent(used, limit))}%` : "不限"}
      </span>
    </Tile>
  )
}

function RenewalTile({ node }: { node: Node }) {
  const days = daysOf(node)
  return (
    <Tile label="续费状态">
      {node.expires_at ? (
        <>
          <span className="block truncate text-[13px]">{node.expires_at}</span>
          <span className="block truncate text-[10px] leading-3 font-medium">
            <span style={{ color: dayColor(days) }}>{daysText(days)}</span>
            {node.price > 0 && <span className="text-muted-foreground"> · {priceText(node)}</span>}
          </span>
        </>
      ) : (
        <span className="block truncate text-[13px]">未设置到期日</span>
      )}
    </Tile>
  )
}

export type Density = "loose" | "compact"

export function NodeCard({ node, onOpen, density = "loose" }: {
  node: Node
  onOpen: () => void
  density?: Density
}) {
  const m = node.metrics
  const compact = density === "compact"
  const cpuPct = m ? m.cpu : null
  const memPct = m ? percent(m.mem_used, m.mem_total) : null
  const diskPct = m ? percent(m.disk_used, m.disk_total) : null
  const Deco = DECOS[node.id % DECOS.length]

  return (
    <Card
      onClick={onOpen}
      className={cn(
        "relative min-w-0 cursor-pointer gap-0 overflow-hidden border-[3px] border-(--frame) transition-colors hover:border-(--frame-hover)",
        "p-3",
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      {/* The case file's prop, printed faint at the corner. */}
      <div aria-hidden className="pointer-events-none absolute right-2 bottom-2 size-14 rotate-[-8deg] text-(--deco) opacity-10 [&_svg]:h-full [&_svg]:w-full">
        <Deco />
      </div>

      {/* The case frame inside the heavy border: a hairline inset a few
          pixels, bowtie-red ticks at its four corners. Painted over the
          prop print but under the figures -- the content wrappers are
          relative and come later in the tree. */}
      <div aria-hidden className="pointer-events-none absolute inset-[6px] rounded-[8px] border border-(--frame-inner)" />
      <div aria-hidden className="pointer-events-none absolute inset-0 text-(--tone-hot)">
        <span className="absolute top-[5px] left-[5px] size-2.5 border-t-2 border-l-2 border-current" />
        <span className="absolute top-[5px] right-[5px] size-2.5 border-t-2 border-r-2 border-current" />
        <span className="absolute bottom-[5px] left-[5px] size-2.5 border-b-2 border-l-2 border-current" />
        <span className="absolute right-[5px] bottom-[5px] size-2.5 border-r-2 border-b-2 border-current" />
      </div>

      <div className="relative flex items-start gap-2.5">
        <FlagBlock node={node} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
              <h3 className="min-w-0 truncate text-[15px] leading-5 font-medium" title={node.name}>{node.name}</h3>
              {!compact && deployed(node) && <HealthBadge node={node} />}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Status node={node} bare />
              <span className="tnum text-[10px] tracking-[0.18em] text-muted-foreground">
                CASE-{String(node.id).padStart(3, "0")}
              </span>
            </div>
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {node.os ? (
              <>
                <span className="shrink-0">{node.group || "未分组"}</span>
                <span aria-hidden>·</span>
                <OsIcon os={node.os} />
                <span className="truncate">{osName(node.os)}</span>
                {node.arch && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{node.arch}</span>
                  </>
                )}
              </>
            ) : (
              "等待首次上报"
            )}
          </p>
        </div>
      </div>

      {deployed(node) ? (
        <div className="relative">
          <div className={cn("grid grid-cols-3 gap-2.5", compact ? "mt-2" : "mt-2.5")}>
            <GradBar label="CPU" pct={cpuPct} />
            <GradBar
              label="内存"
              pct={memPct}
              sub={compact ? undefined : m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
            />
            <GradBar
              label="磁盘"
              pct={diskPct}
              sub={compact ? undefined : m ? `剩 ${bytes(m.disk_total - m.disk_used)}` : bytes(node.disk_total)}
            />
          </div>

          {compact ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <UptimeTile m={m} />
              <MonthTile node={node} />
              <RenewalTile node={node} />
            </div>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Tile label="TCP 连接">{m ? m.tcp : "—"}</Tile>
                <Tile label="UDP 套接字">{m ? m.udp : "—"}</Tile>
                <Tile label="进程数量">{m ? m.procs : "—"}</Tile>
                <Tile label="系统负载">
                  {m ? (
                    <span className="block text-[10px] whitespace-nowrap">
                      {m.load.map((n) => n.toFixed(2)).join("/")}
                    </span>
                  ) : (
                    "—"
                  )}
                </Tile>
                <UptimeTile m={m} />
                <Tile label="CPU 核心">{node.cpu_cores > 0 ? node.cpu_cores : "—"}</Tile>
                <NetworkTile m={m} />
                <MonthTile node={node} />
                <RenewalTile node={node} />
              </div>

              <Latency node={node} />

              <div className="tnum mt-2 flex items-center justify-between border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
                <span>
                  累计 ↓ {bytes(node.total_rx)} / ↑ {bytes(node.total_tx)}
                </span>
                {node.online && m && <span className="shrink-0">实时更新</span>}
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="relative mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}
