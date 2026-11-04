import { useState, useSyncExternalStore } from "react"
import { ChevronDown, ScrollText, Trash2 } from "lucide-react"

import { Card } from "@/components/ui/card"
import { clearEvents, getEvents, subscribeEvents, type EventKind } from "@/lib/events"
import { cn } from "@/lib/utils"

/** The dot each kind is filed under, in the theme's own tones. */
export const EVENT_DOT: Record<EventKind, string> = {
  offline: "var(--tone-hot)",
  online: "var(--tone-ok)",
  waiting: "var(--tone-warn)",
  reporting: "var(--tone-ok)",
  abnormal: "var(--tone-warn)",
  resolved: "var(--muted-foreground)",
}

const pad = (v: number) => String(v).padStart(2, "0")

/** MM-DD HH:mm on the visitor's clock, the one the events were stamped with. */
function stamp(t: number): string {
  const d = new Date(t)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PAGE = 10

/**
 * The case log under the card grid: one line per change the page has
 * witnessed -- a node going down or coming back, tripping or clearing --
 * newest first. Ten lines stand open; the rest unfold in place. Clearing
 * empties the stored log itself, not just this panel's view of it.
 */
export function EventLog({ onOpen }: { onOpen: (id: number) => void }) {
  const events = useSyncExternalStore(subscribeEvents, getEvents)
  const [collapsed, setCollapsed] = useState(false)
  const [all, setAll] = useState(false)
  const shown = all ? events : events.slice(0, PAGE)
  return (
    <Card className="gap-0 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ScrollText className="size-3.5" />
          案件记录
          <ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
        </button>
        <span className="tnum text-xs text-muted-foreground">{events.length} 条</span>
        <div className="flex-1" />
        {events.length > 0 && (
          <button
            type="button"
            onClick={clearEvents}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
            清空
          </button>
        )}
      </div>
      {!collapsed &&
        (events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">暂无记录，节点状态变化后会记在这里</p>
        ) : (
          <>
            <ol className={cn("mt-1.5", all && "max-h-96 overflow-y-auto")}>
              {shown.map((e, i) => (
                <li
                  key={`${e.t}:${e.id}:${e.kind}:${i}`}
                  className="flex items-center gap-2 border-t border-border/50 py-1.5 text-sm first:border-t-0"
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: EVENT_DOT[e.kind] }}
                  />
                  <span className="tnum w-[5.5rem] shrink-0 text-xs text-muted-foreground">{stamp(e.t)}</span>
                  <button
                    type="button"
                    onClick={() => onOpen(e.id)}
                    className="max-w-36 shrink-0 truncate font-medium transition-opacity hover:opacity-70 sm:max-w-52"
                  >
                    {e.name}
                  </button>
                  <span className="min-w-0 truncate text-muted-foreground">{e.text}</span>
                </li>
              ))}
            </ol>
            {events.length > PAGE && (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="mt-1 w-full py-1 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {all ? "收起" : `展开全部 ${events.length} 条`}
              </button>
            )}
          </>
        ))}
    </Card>
  )
}
