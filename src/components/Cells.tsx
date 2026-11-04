import type { CellClass, PingCell } from "@/lib/ping"

/** Fill colour for a utilisation percentage: green under 60, amber to 85, red above. */
export function tier(v: number): string {
  return v < 60 ? "#34c759" : v <= 85 ? "#e8b93c" : "#e5484d"
}

/** The utilisation class of a percentage, on the same breaks as {@link tier}. */
export function tierClass(v: number): "ok" | "warn" | "bad" {
  return v < 60 ? "ok" : v <= 85 ? "warn" : "bad"
}

/**
 * The status strip's colours, one per class. Latency classes come from
 * lib/ping, judged against the probe's own baseline: green at the baseline,
 * yellow above it, orange well above it -- and red for one thing only, a
 * bucket where nothing answered (`lost`), so a timeout is never just the
 * far end of the slowness scale. Utilisation classes come from the absolute
 * breaks above and share the green/yellow/red paints. The same paints carry
 * both colour modes; only the empty slot follows the mode's track.
 */
export const CELL_COLORS: Record<Exclude<CellClass, "none">, string> = {
  ok: "#34c759",
  warn: "#e8b93c",
  high: "#f0762b",
  bad: "#e5484d",
  lost: "#e5484d",
}

export function cellColor(cls: CellClass): string {
  return cls === "none" ? "var(--cell-none)" : CELL_COLORS[cls]
}

/**
 * One probe's latency as a strip of cells, oldest first, each already
 * classified against the probe's own baseline by lib/ping: green near the
 * baseline, yellow above it, orange well above, red where nothing answered,
 * the bare track where the series has no sample yet. `offline` paints the
 * whole strip red: the node is down, whatever the window still holds.
 * A bucket that answered through partial loss keeps its latency colour --
 * the loss rides in its title, which is what the hub sends the row figure for.
 */
export function StatusCells({ cells, offline = false }: {
  cells: PingCell[]
  offline?: boolean
}) {
  return (
    <div className="flex gap-[2px]" aria-hidden>
      {cells.map((cell, i) => {
        const cls = offline ? "lost" : cell.cls
        return (
          <span
            key={i}
            title={
              offline || cls === "lost"
                ? "丢包/无响应"
                : cls === "none"
                  ? "无样本"
                  : `${Math.round(cell.v ?? 0)} ms${cell.loss > 0 ? ` · 丢 ${Math.round(cell.loss)}%` : ""}`
            }
            className="min-w-0 flex-1 rounded-[2px] h-3"
            style={{ background: cellColor(cls), opacity: cls === "none" ? 1 : 0.9 }}
          />
        )
      })}
    </div>
  )
}

/** One cell of a resource strip: a utilisation class, or the bare track. */
export type ResCell = { cls: "ok" | "warn" | "bad" | "none"; title?: string }

/**
 * A proportion as segmented fill: the lit share of the strip is the
 * percentage itself (rounded to whole cells), all lit cells carry the
 * percentage's own tier, and the rest stays track -- a disk reads at a
 * glance the way a battery gauge does.
 */
export function fillCells(pct: number, cells: number): ResCell[] {
  const clamped = Math.min(100, Math.max(0, pct))
  const lit = Math.round((clamped / 100) * cells)
  const cls = tierClass(clamped)
  return Array.from({ length: cells }, (_, i) =>
    i < lit ? { cls, title: `${Math.round(clamped)}%` } : { cls: "none" as const },
  )
}

/** A resource strip: segmented fills for CPU, memory, disk and quota. */
export function ResCells({ cells }: { cells: ResCell[] }) {
  return (
    <div className="flex gap-[2px]" aria-hidden>
      {cells.map((cell, i) => (
        <span
          key={i}
          title={cell.title}
          className="min-w-0 flex-1 rounded-[2px] h-3"
          style={{ background: cellColor(cell.cls), opacity: cell.cls === "none" ? 1 : 0.9 }}
        />
      ))}
    </div>
  )
}
