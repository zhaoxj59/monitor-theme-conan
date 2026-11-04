import { Search } from "lucide-react"

import type { Node } from "@/lib/api"
import { cn } from "@/lib/utils"

export type NodeStatusFilter = "all" | "online" | "waiting" | "offline"

/**
 * The three fleet states, as the 2.0 layer defined them: a node counts as
 * online only once it is actually reporting; connected but silent is its own
 * state, not a flavour of online.
 */
export function nodeStatus(node: Node): Exclude<NodeStatusFilter, "all"> {
  if (node.online && node.metrics) return "online"
  if (node.online) return "waiting"
  return "offline"
}

/** The layer's search haystack: name, group, system, country and arch. */
export function matchesSearch(node: Node, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${node.name} ${node.group ?? ""} ${node.os} ${node.country} ${node.arch}`.toLowerCase().includes(q)
}

const TABS: { value: NodeStatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "online", label: "在线" },
  { value: "waiting", label: "等待上报" },
  { value: "offline", label: "离线" },
]

/**
 * Search and status filter for the card grid only. The summary above and the
 * globe keep counting the whole fleet; this bar merely narrows which cards
 * are on the table.
 */
export function NodeToolbar({ base, shown, query, onQuery, status, onStatus }: {
  base: Node[]
  shown: number
  query: string
  onQuery: (query: string) => void
  status: NodeStatusFilter
  onStatus: (status: NodeStatusFilter) => void
}) {
  const count = (value: NodeStatusFilter) =>
    value === "all" ? base.length : base.filter((n) => nodeStatus(n) === value).length
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex min-w-44 flex-1 items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur sm:max-w-72">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索服务器名称、分组、系统…"
          aria-label="搜索服务器"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="flex rounded-full border border-border bg-card/70 p-0.5 backdrop-blur" role="group" aria-label="状态筛选">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => onStatus(value)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
              status === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            <span className="tnum ml-1 opacity-70">{count(value)}</span>
          </button>
        ))}
      </div>
      <span className="tnum ml-auto text-xs text-muted-foreground">显示 {shown} 台</span>
    </div>
  )
}
