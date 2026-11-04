import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { Card } from "@/components/ui/card"
import type { Node } from "@/lib/api"
import { conclusionsOf, type Conclusion } from "@/lib/inference"
import { cn } from "@/lib/utils"

/**
 * The deduction panel under the banner: only the conclusions the node's
 * own history can carry, each with the figure it rests on, computed once
 * when the page opens. When nothing qualifies the panel renders nothing
 * at all -- an empty frame would claim a verdict the data never gave.
 */
export function Conclusions({ node, historyDays }: { node: Node; historyDays: number }) {
  const [items, setItems] = useState<Conclusion[] | null>(null)
  useEffect(() => {
    let active = true
    conclusionsOf(node, historyDays)
      .then((next) => {
        if (active) setItems(next)
      })
      .catch(() => {
        if (active) setItems([])
      })
    return () => {
      active = false
    }
    // The snapshot fields the sync conclusions read change with every
    // push; the panel is a verdict on the page as opened, not a ticker,
    // so it computes once per node rather than on the whole object.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, historyDays])
  if (!items || items.length === 0) return null
  return (
    <Card className="gap-0 p-3">
      <h3 className="mb-2 text-[13px] font-medium">推理结论</h3>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c.kind} className="flex items-start gap-2 text-sm">
            <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className={cn(c.hot && "font-medium text-(--tone-hot)")}>{c.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
