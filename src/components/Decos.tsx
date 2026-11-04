/**
 * The case-file decorations: eight detective props drawn as plain line SVGs --
 * bowtie, football, skateboard, tranquiliser watch, glasses, detective badge,
 * magnifier, fingerprint. One per card, picked by node id, drawn in a muted
 * steel blue so they read as print on the file rather than as content.
 */

const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

function Bowtie() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <path d="M21 24 6 13v22L21 24Z" />
      <path d="M27 24l15-11v22L27 24Z" />
      <rect x="20" y="18" width="8" height="12" rx="2" />
    </svg>
  )
}
function Football() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <circle cx="24" cy="24" r="17" />
      <path d="M24 15l6 4.3-2.3 7.2h-7.4L18 19.3 24 15Z" />
      <path d="M24 7v8M39.5 18.5 30 19.3M34 36.5l-6.3-10M14 36.5l6.3-10M8.5 18.5 18 19.3" />
    </svg>
  )
}
function Skateboard() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <path d="M5 28c8 3.5 30 3.5 38 0 1.8 2.8-.4 5-3.4 5H8.4C5.4 33 3.2 30.8 5 28Z" />
      <circle cx="15" cy="38" r="3.4" />
      <circle cx="33" cy="38" r="3.4" />
      <path d="M15 33v1.6M33 33v1.6" />
    </svg>
  )
}
function Watch() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <path d="M19 4h10l1.5 9h-13L19 4ZM19 44h10l1.5-9h-13L19 44Z" />
      <circle cx="24" cy="24" r="11" />
      <circle cx="24" cy="24" r="1.4" fill="currentColor" />
      <path d="M24 24 24 17.5M24 24l4.5 2.5" />
      <path d="M35 20l3.5-2M35 28l3.5 2" />
    </svg>
  )
}
function Glasses() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <rect x="4" y="18" width="16" height="13" rx="3" />
      <rect x="28" y="18" width="16" height="13" rx="3" />
      <path d="M20 21c2.7-1.6 5.3-1.6 8 0M4 21 2 15M44 21l2-6" />
      <path d="M9 28.5 16 20" opacity="0.55" />
    </svg>
  )
}
function BadgeDeco() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <circle cx="24" cy="24" r="16" />
      <circle cx="24" cy="24" r="11.5" strokeDasharray="3 3" />
      <path d="M24 17.5l2 4.1 4.5.6-3.3 3.1.8 4.5-4-2.1-4 2.1.8-4.5-3.3-3.1 4.5-.6 2-4.1Z" />
    </svg>
  )
}
function Magnifier() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <circle cx="20" cy="20" r="12" />
      <path d="M29.5 29.5 42 42" strokeWidth="3" />
      <path d="M13 24.5c.8-4.5 3.4-8 7.5-9.5" opacity="0.55" />
    </svg>
  )
}
function Fingerprint() {
  return (
    <svg viewBox="0 0 48 48" {...P}>
      <path d="M37 22.5c0-7-5.5-13.5-13-13.5S11 15.5 11 22.5c0 4.8.7 9.5 1.2 14" />
      <path d="M31.5 35c.8-3.4 1-7.4 1-11 0-4.7-3.8-8.5-8.5-8.5S15.5 19.3 15.5 24c0 5.8.6 10.4 2 15" />
      <path d="M27.5 36.5c.5-3 .8-6.8.8-10.5 0-2.8-1.9-5-4.3-5s-4.3 2.2-4.3 5c0 4.6.4 8.7 1.3 12.5" />
      <path d="M24 24.5v7" />
    </svg>
  )
}

/** The eight decorations in rotation order; a card takes `DECOS[id % 8]`. */
export const DECOS = [Bowtie, Football, Skateboard, Watch, Glasses, BadgeDeco, Magnifier, Fingerprint]

/** The red bowtie that stands for the admin entry, filled rather than lined. */
export function BowtieMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M21 24 5 11.5v25L21 24Z" fill="#c81e1e" stroke="#8f1212" strokeWidth="2" strokeLinejoin="round" />
      <path d="M27 24l16-12.5v25L27 24Z" fill="#c81e1e" stroke="#8f1212" strokeWidth="2" strokeLinejoin="round" />
      <rect x="19.5" y="17" width="9" height="14" rx="2.5" fill="#a81515" stroke="#8f1212" strokeWidth="2" />
    </svg>
  )
}
