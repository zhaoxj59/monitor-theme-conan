import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { Check, Moon, Palette, Sun } from "lucide-react"

import { BowtieMark } from "@/components/Decos"
import { CommandCenter } from "@/components/CommandCenter"
import { DoorIntro } from "@/components/DoorIntro"
import { EventLog } from "@/components/EventLog"
import { FallingCards } from "@/components/FallingCards"
import { Globe } from "@/components/Globe"
import { MonthReport } from "@/components/MonthReport"
import { NodeCard, type Density } from "@/components/NodeCard"
import { NodeToolbar, matchesSearch, nodeStatus, type NodeStatusFilter } from "@/components/NodeToolbar"
import { Summary } from "@/components/Summary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, groupsOf, useNodes, type Node } from "@/lib/api"
import { loadConfig } from "@/lib/config"
import { observeNodes } from "@/lib/events"
import { cn } from "@/lib/utils"

// `history_days` is absent from hubs predating the hourly tier, which kept a
// week for anonymous callers.
type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean; history_days?: number }

const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

function useNodeRoute() {
  const read = () => {
    const match = location.pathname.match(/^\/node\/(\d+)/)
    return match ? Number(match[1]) : null
  }
  const [id, setId] = useState(read)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return [
    id,
    (next: number | null) => {
      const path = next === null ? "/" : `/node/${next}`
      if (location.pathname !== path) history.pushState({}, "", path)
      setId(next)
      scrollTo(0, 0)
    },
  ] as const
}

function useDensity() {
  const [density, setDensity] = useState<Density>(() => {
    try {
      return localStorage.getItem("conan-density") === "compact" ? "compact" : "loose"
    } catch {
      return "loose"
    }
  })
  return [
    density,
    (next: Density) => {
      try {
        localStorage.setItem("conan-density", next)
      } catch {
        // The choice then lasts until the page is closed.
      }
      setDensity(next)
    },
  ] as const
}

type View = "wall" | "cc"

/** The home view: the case wall, or the command centre beside it. Remembered like the density. */
function useView() {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("conan-view") === "cc" ? "cc" : "wall"
    } catch {
      return "wall"
    }
  })
  return [
    view,
    (next: View) => {
      try {
        localStorage.setItem("conan-view", next)
      } catch {
        // The choice then lasts until the page is closed.
      }
      setView(next)
    },
  ] as const
}

type Mode = "dark" | "light"

/**
 * The visitor's day/night choice. Dark is the default -- the theme's home
 * palette, not the system's -- and only the toggle writes the choice down
 * (`conan-mode`); the inline script in index.html has already put the saved
 * mode on <html> before first paint, so this hook's first effect mostly
 * re-affirms it. Switching holds every transition for a frame, the
 * scaffold's own trick, so nothing fades half a beat behind the rest.
 */
function useMode() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem("conan-mode") === "light" ? "light" : "dark"
    } catch {
      return "dark"
    }
  })
  useEffect(() => {
    const hold = document.createElement("style")
    hold.textContent = "*,*::before,*::after{transition:none!important}"
    document.head.append(hold)
    document.documentElement.classList.toggle("dark", mode === "dark")
    // Resolves the new colours while transitions are off, so removing the
    // hold starts none.
    void document.body.offsetWidth
    hold.remove()
  }, [mode])
  return [
    mode,
    () => {
      const next: Mode = mode === "dark" ? "light" : "dark"
      try {
        localStorage.setItem("conan-mode", next)
      } catch {
        // The choice then lasts until the page is closed.
      }
      setMode(next)
    },
  ] as const
}

export type StyleName = "conan" | "kid" | "organization"

export const STYLES: { name: StyleName; label: string; desc: string; mark: string }[] = [
  { name: "conan", label: "柯南经典蓝", desc: "侦探蓝 · 案件档案", mark: "🔎" },
  { name: "kid", label: "落日橙", desc: "落日橙 · 魔术预告", mark: "♠" },
  { name: "organization", label: "黑衣组织暗夜红", desc: "暗夜红 · 秘密档案", mark: "◈" },
]

const isStyle = (v: unknown): v is StyleName => v === "conan" || v === "kid" || v === "organization"

/** The falling cards' pace by the operator's word for it; standard is the pace the cards have always fallen at. */
const CARD_SPEEDS: Record<string, number> = { slow: 0.6, normal: 1, fast: 1.6 }

/** Whether the last config seen had `door_once` on, remembered across loads (see the door in App). */
function doorOnceHint(): boolean {
  try {
    return localStorage.getItem("conan-door-once-cfg") === "1"
  } catch {
    return false
  }
}

/**
 * The header board's portrait cell follows the visual style, so the picture
 * a visitor sees is cut from the same cloth as the palette under it: the
 * clock-tower portrait for the classic blue, the organisation face-off for
 * the dark red, and a warm golden-backlit portrait for the sunset orange.
 * The cell is wide and short against tall art, so each picture names the
 * point `object-cover` must keep -- the focal subject -- rather than
 * trusting the centre, and the standing rule for every one of them is
 * that the subject's head stays whole in the frame: the cell's band is a
 * fraction of the picture's height, and a centre crop spends it on
 * torsos. Shinichi's head rides at y 27-39% of the clock-tower art, so
 * its band is centred on his face (38%), not his belt (the 60% the
 * narrow cell once used, which cut his eyes away once the cell widened);
 * The sunset portrait (1080×1873) replaced the blue-toned Kid city art in
 * 1.2 -- it clashed with the amber palette, and the city picture had no
 * other reference, so the asset was dropped -- its head spans y 10-47%
 * with the eyes at y 33-38%, wider than the ~21% desktop band, so the
 * responsive focal keeps the whole head on a phone (25%, band 12-65%) and
 * the full face including the chin on desktop (33%, band 26-47%), where
 * only the crown is trimmed.
 */
const HEADER_ART: Record<StyleName, { src: string; pos?: string }> = {
  conan: { src: "/assets/style-conan.jpg", pos: "object-[50%_38%]" },
  kid: { src: "/assets/style-kid.jpg", pos: "object-[50%_25%] sm:object-[50%_33%]" },
  // The organisation art is the one wide picture of the three, so its
  // focal point is responsive: centred horizontally while the cell is
  // still narrow enough to crop the sides, then riding high once the
  // cell is wider than the art and the crop turns vertical, so the faces
  // along the top -- Shinichi's and Gin's -- keep the frame.
  organization: { src: "/assets/style-organization.jpg", pos: "object-[40%_50%] sm:object-[50%_20%]" },
}

/**
 * The visitor's visual style, the second axis beside day/night: it recolours
 * the theme through the `data-style` variables in index.css and never touches
 * the mode. The saved choice (`conan-theme-style`, the key the 2.0
 * enhancement layer used, so a pick made there carries over) wins; until the
 * visitor picks one, the operator's config default applies. The inline
 * script in index.html has already restored a saved style before first
 * paint.
 */
function useStyle(configStyle: unknown) {
  // The visitor's own pick, once made; until then the style is derived from
  // the operator's config default during render, so no effect has to chase
  // the config's arrival.
  const [picked, setPicked] = useState<StyleName | null>(() => {
    try {
      const saved = localStorage.getItem("conan-theme-style")
      return isStyle(saved) ? saved : null
    } catch {
      return null
    }
  })
  const style: StyleName = picked ?? (isStyle(configStyle) ? configStyle : "conan")
  useEffect(() => {
    if (style === "conan") delete document.documentElement.dataset.style
    else document.documentElement.dataset.style = style
  }, [style])
  return [
    style,
    (next: StyleName) => {
      try {
        localStorage.setItem("conan-theme-style", next)
      } catch {
        // The choice then lasts until the page is closed.
      }
      setPicked(next)
    },
  ] as const
}

/**
 * The full-moon artwork as the page's ground, washed just enough to read on:
 * the picture stays recognisable -- moon, silhouette and all -- without
 * competing with the cards, which are themselves translucent over it.
 * Roughly half of wash in either mode, a little deeper at the foot; the
 * wash thinned a step when the cards did, so ground and glass thin together.
 */
function Backdrop({ mode }: { mode: Mode }) {
  const light = mode === "light"
  // The washes ride `--background` rather than a hard-coded navy, so the
  // ground recolours with the visual style too -- a style switch that left
  // the page's dominant tint untouched read as no switch at all.
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0">
      <img src="/assets/kid-moon.jpg" alt="" className="h-full w-full object-cover object-top" />
      <div className={cn("absolute inset-0", light ? "bg-background/55" : "bg-background/52")} />
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-b",
          light ? "from-background/30 via-transparent to-background/52" : "from-background/26 via-transparent to-background/47",
        )}
      />
    </div>
  )
}

/**
 * The top-right corner cluster: the style picker, the day/night toggle and
 * the admin entry, a lone red bowtie. All ride the card tokens so they sit
 * as well on paper as on navy.
 */
function CornerTools({ mode, onToggleMode, style, onStyle }: {
  mode: Mode
  onToggleMode: () => void
  style: StyleName
  onStyle: (style: StyleName) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const tool =
    "grid size-11 place-items-center rounded-full border border-border bg-card/60 text-foreground backdrop-blur transition-colors hover:bg-card/90"
  return (
    <div className="fixed top-3 right-3 z-[90] flex gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="视觉风格"
          aria-label="视觉风格"
          aria-expanded={menuOpen}
          className={tool}
        >
          <Palette className="size-5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0" onClick={() => setMenuOpen(false)} />
            <div className="absolute top-12 right-0 w-56 rounded-2xl border border-border bg-card/90 p-1.5 shadow-lg backdrop-blur" role="menu" aria-label="视觉风格">
              {STYLES.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={style === s.name}
                  onClick={() => {
                    onStyle(s.name)
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span aria-hidden className="w-5 text-center text-base">{s.mark}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{s.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{s.desc}</span>
                  </span>
                  {style === s.name && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleMode}
        title={mode === "dark" ? "切换到白天" : "切换到黑夜"}
        aria-label={mode === "dark" ? "切换到白天" : "切换到黑夜"}
        className={tool}
      >
        {mode === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>
      <a href="/admin" target="_blank" rel="noreferrer" title="后台管理" aria-label="后台管理" className={tool}>
        <BowtieMark size={28} />
      </a>
    </div>
  )
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const { nodes, error, closed } = useNodes()
  const [open, go] = useNodeRoute()
  const [group, setGroup] = useState<string | null>(null)
  const [view, setView] = useView()
  const [density, setDensity] = useDensity()
  const [mode, toggleMode] = useMode()
  const [style, setStyle] = useStyle(config?.style)
  // Whether this browser session has already had its door showing, read
  // once at mount: it lets App keep a `door_once` refresh from rendering
  // the doors at all (see the door below), rather than mounting them and
  // letting DoorIntro's own check unmount them a frame later -- a frame
  // that, on a slow load, is long enough to see.
  const [doorSeen] = useState(() => {
    try {
      return sessionStorage.getItem("conan-door-once") === "1"
    } catch {
      return false
    }
  })

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message))
  }, [])

  useEffect(() => {
    loadMe()
    void loadConfig().then(setConfig)
    void loadDetail()
  }, [loadMe])

  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  // The case log is kept at this level rather than in the list below it, so
  // it keeps being written while a node's page is open -- the list unmounts
  // there, the stream does not. It records whether or not its panel shows.
  useEffect(() => {
    if (nodes) observeNodes(nodes)
  }, [nodes])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const selected = sorted.find((n) => n.id === open)

  useEffect(() => {
    document.title = [selected?.name, me?.site_name || "Monitor"].filter(Boolean).join(" · ")
  }, [selected?.name, me?.site_name])

  // `door_once` rides a hint from the last visit until the config lands:
  // the config answers a beat after first paint, and without the hint a
  // refresh under `door_once` would start the doors before the setting
  // arrived to stop them. The hint only ever pre-arms the session check
  // in DoorIntro -- a fresh session still plays, hint or not.
  useEffect(() => {
    if (!config) return
    try {
      localStorage.setItem("conan-door-once-cfg", config.door_once === true ? "1" : "0")
    } catch {
      // No storage: the config's own arrival covers it, a beat later.
    }
  }, [config])

  const doorOnceArmed = config ? config.door_once === true : doorOnceHint()
  const door = (
    <DoorIntro
      enabled={(config ? config.door_intro !== false : true) && !(doorOnceArmed && doorSeen)}
      once={doorOnceArmed}
    />
  )
  // Between the backdrop and the content in DOM order, so the cards drift
  // behind the translucent cards and panels rather than over the figures.
  const falling = (
    <FallingCards
      enabled={config ? config.falling_cards !== false : true}
      dark={mode === "dark"}
      paintKey={`${mode}:${style}`}
      speed={CARD_SPEEDS[config?.cards_speed as string] ?? 1}
    />
  )

  if (!me) return (
    <div className="relative min-h-svh">
      <Backdrop mode={mode} />
      {falling}
      {door}
      <div className="relative grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
        {meError ? (
          <div className="space-y-3 text-center">
            <p role="alert">加载失败：{meError}</p>
            <Button onClick={loadMe}>重试</Button>
          </div>
        ) : "加载中…"}
      </div>
    </div>
  )

  if (!me.public_page && !me.authed) return null

  return (
    <div className="relative min-h-svh">
      <Backdrop mode={mode} />
      {falling}
      {door}
      <CornerTools mode={mode} onToggleMode={toggleMode} style={style} onStyle={setStyle} />

      <div className="relative mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* One row while it fits, wrapping to a second row when it does not:
            the site name truncates and the pills drop below it whole, rather
            than the pills being crushed until their labels wrap a character
            at a time. The right padding reserves the corner tools' ground at
            every width, so nothing ever slides underneath them. */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-[156px]">
          <button className="min-w-0 truncate font-semibold transition-opacity hover:opacity-70" onClick={() => go(null)}>
            {me.site_name || "Monitor"}
          </button>
          <div className="min-w-0 flex-1" />
          {open === null && (
            <div className="flex flex-wrap items-center gap-2">
              {config && config.command_center !== false && (
                <div className="flex shrink-0 rounded-full border border-border bg-card/70 p-0.5 backdrop-blur" role="group" aria-label="视图">
                  {([["wall", "案件墙"], ["cc", "指挥中心"]] as [View, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={view === value}
                      onClick={() => setView(value)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
                        view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {(config?.command_center === false || view === "wall") && (
                <div className="hidden shrink-0 rounded-full border border-border bg-card/70 p-0.5 backdrop-blur min-[420px]:flex" role="group" aria-label="显示密度">
                  {([["loose", "宽松"], ["compact", "紧凑"]] as [Density, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      aria-pressed={density === value}
                      onClick={() => setDensity(value)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors",
                        density === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        <main className="space-y-4 pb-6">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {open !== null ? (
            !nodes ? (
              <Skeleton className="h-96" />
            ) : selected ? (
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail node={selected} historyDays={me.history_days ?? 7} onBack={() => go(null)} />
              </Suspense>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">
                节点不存在或未公开。<button className="underline" onClick={() => go(null)}>返回列表</button>
              </p>
            )
          ) : !nodes || !config ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-72" />
              ))}
            </div>
          ) : config.command_center !== false && view === "cc" ? (
            <CommandCenter nodes={sorted} onOpen={go} showHeatmap={config.show_heatmap !== false} />
          ) : (
            <>
              {/* The header case board: the style's artwork takes the
                  first two of the old three columns whole and the globe
                  keeps the third, at every width and in every style. The
                  board used to carry a motto column between portrait and
                  globe; it cost the narrower portraits their subjects and
                  the wide organisation face-off its entire right half, so
                  the words stepped aside -- first for the organisation in
                  3.0.4, then for all three. The widths below are the old
                  split restated: portrait plus motto (28 + 72*50% on small
                  screens, 30 + 70*38% from sm up), globe untouched. The
                  portrait cell also drops the fade-to-background its narrow
                  self wore: against a wide cell the gradient only ate the
                  picture's right edge. */}
              <section className="flex h-48 overflow-hidden rounded-2xl border border-border sm:h-64">
                <div className="relative w-[64%] shrink-0 sm:w-[56.6%]">
                  <img
                    key={style}
                    src={HEADER_ART[style].src}
                    alt=""
                    className={cn("absolute inset-0 h-full w-full object-cover", HEADER_ART[style].pos)}
                  />
                </div>
                <div
                  className={cn(
                    "relative min-w-0 flex-1",
                    mode === "light" ? "bg-background/50" : "bg-background/55",
                  )}
                >
                  <Globe nodes={sorted} onOpen={go} dark={mode === "dark"} paintKey={`${mode}:${style}`} />
                </div>
              </section>

              <NodeList
                nodes={sorted}
                group={group}
                summary={config.show_summary === true}
                showSearch={config.show_search !== false}
                showEvents={config.show_events !== false}
                historyDays={me.history_days ?? 7}
                siteName={me.site_name || "Monitor"}
                density={density}
                onGroup={setGroup}
                onOpen={go}
              />
            </>
          )}
        </main>

        <footer className="tnum pb-5 text-center text-[11px] tracking-[0.18em] text-muted-foreground">
          CASE WALL · {(me.site_name || "Monitor").toUpperCase()}
        </footer>
      </div>
    </div>
  )
}

function NodeList({ nodes, group, summary, showSearch, showEvents, historyDays, siteName, density, onGroup, onOpen }: {
  nodes: Node[]
  group: string | null
  summary: boolean
  showSearch: boolean
  showEvents: boolean
  historyDays: number
  siteName: string
  density: Density
  onGroup: (group: string | null) => void
  onOpen: (id: number) => void
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<NodeStatusFilter>("all")
  const groups = groupsOf(nodes)
  const ungrouped = nodes.filter((n) => !n.group).length
  const current = group === null || (group === "" ? ungrouped > 0 : groups.includes(group)) ? group : null
  useEffect(() => {
    if (current !== group) onGroup(current)
  }, [current, group, onGroup])
  const shown = current === null ? nodes : nodes.filter((n) => (n.group ?? "") === current)
  // The toolbar narrows the cards alone: the summary keeps the whole fleet
  // and the globe its own list, whatever is typed or tapped here.
  const filtered = shown
    .filter((n) => status === "all" || nodeStatus(n) === status)
    .filter((n) => matchesSearch(n, query))
  const tabs = [
    [null, "全部", nodes.length] as const,
    ...groups.map((g) => [g, g, nodes.filter((n) => n.group === g).length] as const),
    ...(ungrouped ? [["", "未分组", ungrouped] as const] : []),
  ]
  return (
    <>
      {groups.length > 0 && (
        <div role="group" aria-label="分组" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {tabs.map(([value, label, count]) => (
            <Button
              key={value === null ? "*" : `=${value}`}
              aria-pressed={current === value}
              size="sm"
              variant={current === value ? "secondary" : "ghost"}
              className="shrink-0"
              onClick={() => onGroup(value)}
            >
              {label}
              <span className="tnum text-muted-foreground">{count}</span>
            </Button>
          ))}
        </div>
      )}
      {summary && <Summary nodes={nodes} onOpen={onOpen} />}
      {showSearch && nodes.length > 0 && (
        <NodeToolbar base={shown} shown={filtered.length} query={query} onQuery={setQuery} status={status} onStatus={setStatus} />
      )}
      {nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">还没有节点</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">没有符合条件的服务器</p>
      ) : (
        <div className="grid items-start gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((n) => (
            <NodeCard key={n.id} node={n} density={density} onOpen={() => onOpen(n.id)} />
          ))}
        </div>
      )}
      {nodes.length > 0 && <MonthReport nodes={nodes} historyDays={historyDays} siteName={siteName} />}
      {showEvents && <EventLog onOpen={onOpen} />}
    </>
  )
}
