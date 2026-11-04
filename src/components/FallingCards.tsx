import { useEffect, useRef } from "react"

/**
 * The falling playing cards from the Kid artwork, drifting over the whole
 * page: a fixed canvas between the moon backdrop and the content, so the
 * cards pass behind the translucent cards rather than over the figures.
 * Sprites are prerendered once -- faces with rank and suit, a back in the
 * style's frame colour --
 * and each falling card sways, tumbles (scaleX through zero reads as a
 * flip) and spins slowly, paper-style rather than on rails.
 */

const RANKS = ["A", "K", "Q", "J"]
const SUITS = [
  { glyph: "♠", red: false },
  { glyph: "♥", red: true },
  { glyph: "♦", red: true },
  { glyph: "♣", red: false },
] as const

/** Supersampling for the sprites, so a 40 px card still draws crisp. */
const SS = 3

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function faceSprite(rank: string, suit: (typeof SUITS)[number]): HTMLCanvasElement {
  const w = 60 * SS
  const h = 84 * SS
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")!
  const pad = 3 * SS
  roundRect(ctx, pad / 2, pad / 2, w - pad, h - pad, 7 * SS)
  ctx.fillStyle = "#fdfcf7"
  ctx.fill()
  ctx.strokeStyle = "rgba(30, 41, 66, 0.35)"
  ctx.lineWidth = SS
  ctx.stroke()
  const ink = suit.red ? "#c0272d" : "#232c3f"
  ctx.fillStyle = ink
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  // Corner indices, top-left and bottom-right (the second turned round).
  ctx.font = `700 ${17 * SS}px Georgia, "Times New Roman", serif`
  for (const flip of [false, true]) {
    ctx.save()
    ctx.translate(flip ? w - 11 * SS : 11 * SS, flip ? h - 10 * SS : 10 * SS)
    if (flip) ctx.rotate(Math.PI)
    ctx.fillText(rank, 0, -3 * SS)
    ctx.font = `${13 * SS}px Georgia, serif`
    ctx.fillText(suit.glyph, 0, 9 * SS)
    ctx.restore()
    ctx.font = `700 ${17 * SS}px Georgia, "Times New Roman", serif`
  }
  // The pip in the middle, sized like a real card's.
  ctx.font = `${44 * SS}px Georgia, serif`
  ctx.fillText(suit.glyph, w / 2, h / 2 + SS)
  return c
}

/** `hex` mixed toward an RGB triple by `f` (0 keeps it, 1 lands on it). */
function mixHex(hex: string, other: [number, number, number], f: number): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v + (other[i] - v) * f))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/**
 * The card back in the style's frame colour, darkened toward a real back's
 * depth (more at night, where the frame runs bright); the lattice and the
 * inner frame are the same colour mixed toward white. A hard-coded navy
 * back under the orange or red styles was one of the places a style switch
 * visibly failed to reach.
 */
function backSprite(color: string): HTMLCanvasElement {
  const w = 60 * SS
  const h = 84 * SS
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")!
  const pad = 3 * SS
  roundRect(ctx, pad / 2, pad / 2, w - pad, h - pad, 7 * SS)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = mixHex(color, [0, 0, 0], 0.25) ?? "rgba(30, 41, 66, 0.4)"
  ctx.lineWidth = SS
  ctx.stroke()
  // The classic lattice back, clipped to an inner frame.
  ctx.save()
  roundRect(ctx, 7 * SS, 7 * SS, w - 14 * SS, h - 14 * SS, 4 * SS)
  ctx.clip()
  ctx.strokeStyle = mixHex(color, [255, 255, 255], 0.55) ?? "rgba(190, 208, 238, 0.5)"
  ctx.lineWidth = SS
  const step = 10 * SS
  for (let x = -h; x < w + h; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + h, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + h, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  ctx.restore()
  roundRect(ctx, 7 * SS, 7 * SS, w - 14 * SS, h - 14 * SS, 4 * SS)
  ctx.strokeStyle = mixHex(color, [255, 255, 255], 0.85) ?? "rgba(233, 239, 249, 0.85)"
  ctx.lineWidth = 1.4 * SS
  ctx.stroke()
  return c
}

type Card = {
  face: HTMLCanvasElement
  back: HTMLCanvasElement
  w: number
  baseX: number
  y: number
  vy: number
  swayAmp: number
  swayFreq: number
  swayPhase: number
  rotAmp: number
  rotFreq: number
  flipFreq: number
  flipPhase: number
  alpha: number
}

export function FallingCards({ enabled, dark, paintKey, speed }: {
  enabled: boolean
  dark: boolean
  /** Mode + style, so the back's colour refreshes when either axis turns. */
  paintKey: string
  /** Fall-speed multiplier from the operator's setting; 1 is the original pace. */
  speed: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const alphaRef = useRef(0.68)
  // Read at spawn time like the card back: a pace change deals new cards at
  // the new speed and leaves the ones already falling to finish at theirs,
  // so the loop never restarts for a settings tweak.
  const speedRef = useRef(1)
  // Sprites live in a ref so a style switch can swap the back mid-flight:
  // cards already falling keep the back they spawned with, new ones take
  // the new colour, and the loop never restarts.
  const spritesRef = useRef<{ faces: HTMLCanvasElement[]; back: HTMLCanvasElement } | null>(null)
  const backColorRef = useRef("")

  const ensureSprites = () => {
    if (!spritesRef.current) {
      spritesRef.current = {
        faces: RANKS.flatMap((rank) => SUITS.map((suit) => faceSprite(rank, suit))),
        back: backSprite(backColorRef.current || "#162e5a"),
      }
    }
    return spritesRef.current
  }

  useEffect(() => {
    alphaRef.current = dark ? 0.68 : 0.58
  }, [dark])

  useEffect(() => {
    speedRef.current = speed > 0 ? speed : 1
  }, [speed])

  useEffect(() => {
    let frame = ""
    try {
      frame = getComputedStyle(document.documentElement).getPropertyValue("--frame").trim()
    } catch {
      // No computed style to read: the last back stays.
    }
    const color = mixHex(frame, [0, 0, 0], dark ? 0.45 : 0.15)
    if (!color || color === backColorRef.current) return
    backColorRef.current = color
    if (spritesRef.current) {
      spritesRef.current = { faces: spritesRef.current.faces, back: backSprite(color) }
    }
  }, [dark, paintKey])

  useEffect(() => {
    if (!enabled) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const sprites = ensureSprites()

    let width = 0
    let height = 0
    let cards: Card[] = []

    const makeCard = (initial: boolean): Card => {
      const w = 26 + Math.random() * 20 // 26–46 px wide
      const duration = 9 + Math.random() * 7 // 9–16 s top to bottom
      const pace = speedRef.current
      // The sway, spin and flip quicken at half the fall's own change, so a
      // faster rain still reads as paper drifting, not paper hurrying.
      const rhythm = (1 + pace) / 2
      return {
        face: sprites.faces[Math.floor(Math.random() * sprites.faces.length)],
        // Read at spawn time, so a card dealt after a style switch wears
        // the new back while the ones already falling keep theirs.
        back: spritesRef.current?.back ?? sprites.back,
        w,
        baseX: Math.random() * Math.max(width, 1),
        y: initial ? Math.random() * (height + 200) - 200 : -140 - Math.random() * 160,
        vy: ((height + 320) / duration) * pace,
        swayAmp: 10 + Math.random() * 16,
        swayFreq: ((Math.PI * 2) / (2.5 + Math.random() * 2.5)) * rhythm,
        swayPhase: Math.random() * Math.PI * 2,
        rotAmp: 0.35 + Math.random() * 0.3,
        rotFreq: ((Math.PI * 2) / (3.5 + Math.random() * 3)) * rhythm,
        flipFreq: ((Math.PI * 2) / (2.2 + Math.random() * 2.3)) * rhythm,
        flipPhase: Math.random() * Math.PI * 2,
        alpha: 0.75 + Math.random() * 0.25,
      }
    }

    const seed = () => {
      const cap = width < 640 ? 7 : 11
      cards = Array.from({ length: cap }, () => makeCard(true))
    }

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      width = innerWidth
      height = innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (cards.length === 0) seed()
    }
    resize()
    addEventListener("resize", resize)

    let raf = 0
    let last = performance.now()
    const t0 = last
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const t = (now - t0) / 1000
      ctx.clearRect(0, 0, width, height)
      for (let i = 0; i < cards.length; i++) {
        let card = cards[i]
        card.y += card.vy * dt
        if (card.y - card.w * 1.4 > height) {
          cards[i] = makeCard(false)
          card = cards[i]
        }
        const x = card.baseX + Math.sin(t * card.swayFreq + card.swayPhase) * card.swayAmp
        const rot = Math.sin(t * card.rotFreq + card.swayPhase) * card.rotAmp
        const flip = Math.cos(t * card.flipFreq + card.flipPhase)
        ctx.save()
        ctx.globalAlpha = alphaRef.current * card.alpha
        ctx.translate(x, card.y)
        ctx.rotate(rot)
        ctx.scale(Math.max(Math.abs(flip), 0.04) * Math.sign(flip || 1), 1)
        const h = card.w * 1.4
        ctx.drawImage(flip >= 0 ? card.face : card.back, -card.w / 2, -h / 2, card.w, h)
        ctx.restore()
      }
    }
    raf = requestAnimationFrame(tick)

    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [enabled])

  if (!enabled) return null
  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />
}
