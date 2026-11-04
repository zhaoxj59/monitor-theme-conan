import { useEffect, useRef } from "react"

import type { Node } from "@/lib/api"
import { CENTROIDS, LAND_DOTS } from "@/lib/geo"

/**
 * A dotted globe on canvas: land sampled from real country polygons (see
 * lib/geo.ts), rotating on its own, draggable, with a red dot per node at its
 * country's centroid. A press that moves less than 7px is a click and opens
 * the node it lands on; the hit area is far larger than the dot. Hovering a
 * dot pauses the rotation so it can be aimed at, and dots on the far side are
 * neither drawn nor clickable.
 */
type Palette = { sphere: string; rim: string; land: string; offline: string; ring: string }

/**
 * Canvas paint for the two modes: the night sphere and its paper twin.
 * These are the fallback and the shape; the live palette is derived from
 * the theme's CSS variables (see derivePaint), so the sphere follows the
 * visual style as well as the mode -- a hard-coded blue landmass under a
 * red style read as the switch doing nothing.
 */
const PALETTES: Record<"dark" | "light", Palette> = {
  dark: {
    sphere: "rgba(10, 28, 58, 0.85)",
    rim: "rgba(126, 166, 216, 0.35)",
    land: "#7ea6d8",
    offline: "#8fa3c0",
    ring: "rgba(255, 255, 255, 0.85)",
  },
  light: {
    sphere: "rgba(205, 222, 242, 0.92)",
    rim: "rgba(38, 84, 140, 0.5)",
    land: "#2f5d96",
    offline: "#5f7a9d",
    ring: "rgba(21, 42, 78, 0.55)",
  },
}

function hexToRgba(hex: string, alpha: number): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * The sphere's paint from the variables the mode/style blocks set: ground
 * and ring at the fallback's alphas, land and offline taken solid. For the
 * conan palettes this reproduces PALETTES within a few points per channel.
 */
function derivePaint(dark: boolean): Palette {
  const fallback = dark ? PALETTES.dark : PALETTES.light
  try {
    const cs = getComputedStyle(document.documentElement)
    const v = (name: string) => cs.getPropertyValue(name).trim()
    const sphere = hexToRgba(v("--background"), dark ? 0.85 : 0.92)
    const rim = hexToRgba(v("--ring"), dark ? 0.35 : 0.5)
    const ring = hexToRgba(v("--foreground"), dark ? 0.85 : 0.55)
    const land = v("--deco")
    const offline = v("--offline")
    if (!sphere || !rim || !ring || !land || !offline) return fallback
    return { sphere, rim, land, offline, ring }
  } catch {
    return fallback
  }
}

export function Globe({ nodes, onOpen, dark, paintKey }: {
  nodes: Node[]
  onOpen: (id: number) => void
  dark: boolean
  /** Mode + style, so the derived paint refreshes when either axis turns. */
  paintKey: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef(nodes)
  const openRef = useRef(onOpen)
  const darkRef = useRef(dark)
  const paintRef = useRef<Palette>(PALETTES.dark)
  useEffect(() => {
    nodesRef.current = nodes
    openRef.current = onOpen
    darkRef.current = dark
  })
  useEffect(() => {
    paintRef.current = derivePaint(dark)
  }, [dark, paintKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let width = 0
    let height = 0
    let raf = 0
    let rot = 40 // degrees of longitude rotated toward the viewer
    let dragging = false
    let hoverId: number | null = null
    let downAt: [number, number] | null = null
    let moved = 0
    let lastX = 0
    // Screen positions from the latest frame, for hit-testing hover and clicks.
    let hits: { id: number; x: number; y: number }[] = []

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    // Pre-projected unit vectors for the land dots.
    const land = new Float32Array(LAND_DOTS.length)
    for (let i = 0; i < LAND_DOTS.length; i += 2) {
      const lon = (LAND_DOTS[i] * Math.PI) / 180
      const lat = (LAND_DOTS[i + 1] * Math.PI) / 180
      land[i] = Math.cos(lat) * Math.sin(lon)
      land[i + 1] = Math.sin(lat)
    }
    const landZ = new Float32Array(LAND_DOTS.length / 2)
    for (let i = 0; i < LAND_DOTS.length; i += 2) {
      const lon = (LAND_DOTS[i] * Math.PI) / 180
      const lat = (LAND_DOTS[i + 1] * Math.PI) / 180
      landZ[i / 2] = Math.cos(lat) * Math.cos(lon)
    }

    const project = (lonDeg: number, latDeg: number, cx: number, cy: number, r: number) => {
      const lon = ((lonDeg + rot) * Math.PI) / 180
      const lat = (latDeg * Math.PI) / 180
      const x = Math.cos(lat) * Math.sin(lon)
      const z = Math.cos(lat) * Math.cos(lon)
      return { x: cx + x * r, y: cy - Math.sin(lat) * r, z }
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!dragging && hoverId === null) rot = (rot + 0.05) % 360
      ctx.clearRect(0, 0, width, height)
      const cx = width / 2
      const cy = height / 2
      const r = Math.min(width, height) / 2 - 6
      if (r <= 0) return

      const pal = paintRef.current

      // The sphere itself.
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = pal.sphere
      ctx.fill()
      ctx.strokeStyle = pal.rim
      ctx.lineWidth = 1
      ctx.stroke()

      // Land: rotate each dot's longitude by working in the rotated frame --
      // recompute z and x with the current rotation from the stored lon/lat.
      const rotRad = (rot * Math.PI) / 180
      const cosR = Math.cos(rotRad)
      const sinR = Math.sin(rotRad)
      const dotR = Math.max(0.9, r / 105)
      ctx.fillStyle = pal.land
      for (let i = 0, j = 0; i < LAND_DOTS.length; i += 2, j++) {
        const x0 = land[i]
        const z0 = landZ[j]
        const x = x0 * cosR + z0 * sinR
        const z = z0 * cosR - x0 * sinR
        if (z <= 0.02) continue
        ctx.globalAlpha = 0.25 + 0.75 * z
        ctx.fillRect(cx + x * r - dotR / 2, cy - land[i + 1] * r - dotR / 2, dotR, dotR)
      }
      ctx.globalAlpha = 1

      // Node dots. Nodes sharing a country fan out a few pixels so each keeps
      // its own hit area.
      hits = []
      const byCountry = new Map<string, number>()
      for (const n of nodesRef.current) {
        const c = CENTROIDS[n.country]
        if (!c) continue
        const seen = byCountry.get(n.country) ?? 0
        byCountry.set(n.country, seen + 1)
        const p = project(c[0], c[1], cx, cy, r)
        if (p.z <= 0.05) continue
        const angle = seen * 2.4
        const x = p.x + (seen ? Math.cos(angle) * 9 : 0)
        const y = p.y + (seen ? Math.sin(angle) * 9 : 0)
        hits.push({ id: n.id, x, y })
        ctx.beginPath()
        ctx.arc(x, y, 8, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(229, 72, 77, 0.22)"
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, hoverId === n.id ? 4.4 : 3.4, 0, Math.PI * 2)
        ctx.fillStyle = n.online ? "#ff5252" : pal.offline
        ctx.fill()
        ctx.strokeStyle = pal.ring
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    raf = requestAnimationFrame(draw)

    const pos = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [e.clientX - rect.left, e.clientY - rect.top]
    }
    const hitAt = (x: number, y: number) =>
      hits.find((h) => (h.x - x) ** 2 + (h.y - y) ** 2 <= 22 ** 2)?.id ?? null

    const down = (e: PointerEvent) => {
      dragging = true
      moved = 0
      downAt = pos(e)
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - lastX
        lastX = e.clientX
        moved += Math.abs(dx)
        rot = (rot + dx * 0.3) % 360
      } else {
        const [x, y] = pos(e)
        hoverId = hitAt(x, y)
        canvas.style.cursor = hoverId !== null ? "pointer" : "grab"
      }
    }
    const up = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      if (downAt && moved < 7) {
        const [x, y] = pos(e)
        const id = hitAt(x, y)
        if (id !== null) openRef.current(id)
      }
      downAt = null
    }
    canvas.addEventListener("pointerdown", down)
    canvas.addEventListener("pointermove", move)
    canvas.addEventListener("pointerup", up)
    canvas.addEventListener("pointercancel", up)
    canvas.addEventListener("pointerleave", () => (hoverId = null))

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener("pointerdown", down)
      canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerup", up)
      canvas.removeEventListener("pointercancel", up)
    }
  }, [])

  return <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ cursor: "grab" }} aria-label="节点分布地球仪" />
}
