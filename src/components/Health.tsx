import { Card } from "@/components/ui/card"
import { daysOf } from "@/components/NodeCard"
import type { Node } from "@/lib/api"
import { GRADE_COLOR, GRADE_LABEL, healthOf } from "@/lib/health"
import { usePing } from "@/lib/ping"

/**
 * The health pill in a card's header: the score and its grade word, in
 * the grade's own tone. It rides the card's own ping window, so the
 * number is the same one the detail breakdown shows; while that window
 * loads the pill simply is not there yet.
 */
export function HealthBadge({ node }: { node: Node }) {
  const ping = usePing(node.id, 6, 24)
  const health = healthOf(node, ping, daysOf(node))
  if (!health) return null
  const color = GRADE_COLOR[health.grade]
  return (
    <span
      className="tnum flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium"
      style={{ borderColor: color, color }}
      title={health.parts.map((p) => `${p.label} ${p.got}/${p.max}`).join(" · ")}
    >
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      {health.total} {GRADE_LABEL[health.grade]}
    </span>
  )
}

/**
 * The breakdown on the detail page: one scored bar per part beside the
 * total. A part the data could not judge -- the probe window above all --
 * keeps its bar empty and says so, rather than borrowing a score.
 */
export function HealthPanel({ node }: { node: Node }) {
  const ping = usePing(node.id, 6, 24)
  const health = healthOf(node, ping, daysOf(node))
  if (!health) return null
  const color = GRADE_COLOR[health.grade]
  return (
    <Card className="gap-0 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium">健康评级</h3>
        <span className="tnum text-sm font-semibold" style={{ color }}>
          {health.total} 分 · {GRADE_LABEL[health.grade]}
        </span>
      </div>
      <div className="space-y-1.5">
        {health.parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-muted-foreground">{p.label}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-(--track)">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(p.got / p.max) * 100}%`, background: color }}
              />
            </div>
            <span className="tnum w-12 shrink-0 text-right">
              {p.key === "probe" && health.probeInsufficient ? "—" : `${p.got} / ${p.max}`}
            </span>
            <span className="tnum hidden w-56 shrink-0 truncate text-muted-foreground sm:block">{p.note}</span>
          </div>
        ))}
      </div>
      {health.probeInsufficient && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">探测数据不足，总分按其余三项折算</p>
      )}
    </Card>
  )
}
