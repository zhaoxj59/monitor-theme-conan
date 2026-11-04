import { useEffect, useMemo, useState } from "react"
import { ChevronDown, LayoutGrid } from "lucide-react"

import { Card } from "@/components/ui/card"
import { CELL_COLORS } from "@/components/Cells"
import type { Node } from "@/lib/api"
import { baselineOf, classifyCell, fetchPing, type PingData, type ProbeSeries } from "@/lib/ping"
import { cn } from "@/lib/utils"

/**
 * Every node's card window at once, shared through lib/ping's cache: the
 * wall asks for exactly what the loose cards ask for, so a fleet already
 * showing its strips costs the wall no extra history scans.
 */
function useFleetPing(nodes: Node[]): Map<number, PingData | null> {
  const [map, setMap] = useState<Map<number, PingData | null>>(new Map())
  const ids = nodes.map((n) => n.id).join(",")
  useEffect(() => {
    let active = true
    for (const id of ids ? ids.split(",").map(Number) : []) {
      fetchPing(id, 6, 24).then((data) => {
        if (active) setMap((prev) => (prev.get(id) === data ? prev : new Map(prev).set(id, data)))
      })
    }
    return () => {
      active = false
    }
  }, [ids])
  return map
}

type Cell = { text: string; bg: string; fg: string; title: string }

/**
 * Zero-width break opportunities for a node name: after every hyphen and
 * at every CJK/Latin seam, so a long name folds inside its column at a
 * seam rather than being cut with an ellipsis -- or through the middle
 * of a Latin word, which plain break-all would do to "premium".
 */
function breakable(name: string): string {
  return name
    .replace(/-/g, "-\u200b")
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1\u200b$2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1\u200b$2")
}

/**
 * One probe on one node: its most recent answered latency, coloured
 * against its own baseline by the same classes the card strips use. A
 * newest bucket that never answered is a timeout, in the lost colour;
 * a probe the node does not carry, or a window with nothing answered,
 * is an empty slot rather than a claim.
 */
function cellOf(probe: ProbeSeries | undefined): Cell {
  const empty: Cell = { text: "—", bg: "var(--cell-none)", fg: "var(--muted-foreground)", title: "无数据" }
  if (!probe || probe.values.length === 0) return empty
  const newest = probe.values[probe.values.length - 1]
  if (newest === null) {
    return { text: "超时", bg: CELL_COLORS.lost, fg: "#fff", title: `${probe.name} · 最新桶无响应 · 丢包 ${Math.round(probe.loss)}%` }
  }
  const last = probe.last
  if (last === null) return empty
  const baseline = baselineOf(probe.values)
  const cls = baseline === null ? "lost" : classifyCell(last, baseline)
  return {
    text: `${Math.round(last)}`,
    bg: CELL_COLORS[cls],
    fg: "#fff",
    title: `${probe.name} · ${Math.round(last)} ms · 丢包 ${Math.round(probe.loss * 10) / 10}%`,
  }
}

/**
 * The fleet's lines on one wall: a row per node, a column per probe --
 * the union over the fleet, busiest first -- each cell the probe's
 * current latency in its baseline colours. Wide fleets of probes scroll
 * sideways rather than crush the cells, and no name is ever truncated:
 * probe names fold character by character, node names at their seams,
 * so a long name costs a taller row rather than its tail.
 */
export function HeatWall({ nodes, onOpen }: { nodes: Node[]; onOpen: (id: number) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const fleet = useFleetPing(nodes)
  const columns = useMemo(() => {
    const freq = new Map<string, number>()
    for (const data of fleet.values()) {
      for (const p of data?.probes ?? []) freq.set(p.name, (freq.get(p.name) ?? 0) + 1)
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
  }, [fleet])
  if (nodes.length === 0) return null
  return (
    <Card className="gap-0 p-3">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <LayoutGrid className="size-3.5" />
        探测热力墙
        <ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
      </button>
      {!collapsed && (
        <div className="mt-2 overflow-x-auto">
          <div
            className="grid min-w-[34rem] items-center gap-1"
            style={{ gridTemplateColumns: `minmax(6.5rem, 9rem) repeat(${Math.max(1, columns.length)}, minmax(3.2rem, 1fr))` }}
          >
            <span />
            {columns.map((name) => (
              <span key={name} className="px-1 text-center text-[11px] leading-tight whitespace-normal break-all text-muted-foreground" title={name}>
                {name}
              </span>
            ))}
            {nodes.map((n) => {
              const data = fleet.get(n.id)
              const byName = new Map((data?.probes ?? []).map((p) => [p.name, p]))
              return [
                <button
                  key={`n${n.id}`}
                  type="button"
                  onClick={() => onOpen(n.id)}
                  className="pr-2 text-left text-xs leading-snug font-medium whitespace-normal [overflow-wrap:break-word] transition-opacity hover:opacity-70"
                  title={n.name}
                >
                  {breakable(n.name)}
                </button>,
                ...columns.map((name) => {
                  const cell = cellOf(byName.get(name))
                  return (
                    <span
                      key={`${n.id}:${name}`}
                      className="tnum grid h-7 place-items-center rounded-md text-[11px] font-medium"
                      style={{ background: `${cell.bg}${cell.bg.startsWith("#") ? "8c" : ""}`, color: cell.fg, opacity: cell.bg.startsWith("#") ? 1 : 0.7 }}
                      title={cell.title}
                    >
                      {cell.text}
                    </span>
                  )
                }),
              ]
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span><i className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ background: CELL_COLORS.ok }} />基线附近</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ background: CELL_COLORS.warn }} />偏高</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ background: CELL_COLORS.high }} />明显偏高</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm align-middle" style={{ background: CELL_COLORS.lost }} />超时</span>
            <span><i className="mr-1 inline-block size-2 rounded-sm align-middle bg-foreground/10" />无数据</span>
          </div>
        </div>
      )}
    </Card>
  )
}
