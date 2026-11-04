import { useEffect, useRef, useState } from "react"

/**
 * The door opening: on a full page load (never on in-app navigation, which
 * does not remount this), the user's door photograph fills the screen at full
 * height, split along its centre seam into two leaves hinged at their outer
 * edges. After a beat the leaves swing into the screen -- rotateY +102° on the
 * left leaf, −102° on the right -- and the layer fades. A tap skips it.
 */
export function DoorIntro({ enabled, once }: { enabled: boolean; once?: boolean }) {
  const [phase, setPhase] = useState<"hold" | "open" | "fade" | "gone">("hold")
  // Whether the timeline has ever started. It is also what keeps a
  // disabled mount from poisoning the intro: App now mounts this
  // component disabled while the config is in flight, and an earlier
  // shape of this code answered a disabled mount by jumping straight to
  // "gone" -- after which the doors could never play when the config
  // arrived switching them on. Disabled-before-start therefore leaves
  // the phase untouched; only a switch-off after the start ends it.
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      if (startedRef.current) setPhase("gone")
      return
    }
    if (startedRef.current) return
    startedRef.current = true
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // oxlint-disable-next-line react/set-state-in-effect -- ending the intro is the effect's job: the phase machine is driven from here.
      setPhase("gone")
      return
    }
    const timers = [
      setTimeout(() => setPhase("open"), 350),
      setTimeout(() => setPhase("fade"), 350 + 1200),
      setTimeout(() => setPhase("gone"), 350 + 1200 + 400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [enabled])

  // `door_once`: one showing per browser session. The marker is written as
  // the first showing begins, so a refresh -- even one mid-intro -- lands
  // past the doors; a new tab or a reopened browser starts a new session
  // and shows them again. The config arrives after first paint, so this
  // runs when `once` lands as well as on mount; storage that refuses (a
  // locked-down browser) leaves the intro playing every time.
  useEffect(() => {
    if (!enabled || !once) return
    let seen = false
    try {
      seen = sessionStorage.getItem("conan-door-once") === "1"
      if (!seen) sessionStorage.setItem("conan-door-once", "1")
    } catch {
      // No session storage to remember with: the doors play as they did.
    }
    // oxlint-disable-next-line react/set-state-in-effect -- same phase machine: a seen session ends the intro from here.
    if (seen) setPhase("gone")
  }, [enabled, once])

  // Scroll lock: only while the doors are actually going to show. A
  // disabled mount (config in flight, door_intro off, or a door_once
  // session that already saw them) leaves the phase parked at "hold",
  // so locking on phase alone would freeze the page's scroll forever.
  useEffect(() => {
    if (!enabled || phase === "gone") return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [enabled, phase])

  if (!enabled || phase === "gone") return null

  const opening = phase === "open" || phase === "fade"
  const leaf = (side: "left" | "right") => ({
    backgroundImage: "url(/assets/door.jpg)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    clipPath: side === "left" ? "inset(0 49.5% 0 0)" : "inset(0 0 0 50.5%)",
    transformOrigin: side === "left" ? "0% 50%" : "100% 50%",
    transform: opening ? `rotateY(${side === "left" ? 102 : -102}deg)` : "rotateY(0deg)",
    transition: "transform 1.2s cubic-bezier(0.6, 0.02, 0.3, 1)",
  })

  return (
    <div
      role="presentation"
      onClick={() => setPhase("gone")}
      className="fixed inset-0 z-[100] bg-[#050b18]"
      style={{ opacity: phase === "fade" ? 0 : 1, transition: "opacity 0.4s ease" }}
    >
      {/* Height fills the screen; width follows the photograph's own ratio and
          centres, so the seam stays mid-screen on any viewport. */}
      <div
        className="absolute top-0 left-1/2 h-dvh -translate-x-1/2"
        style={{ aspectRatio: "2048 / 1460", perspective: "1500px" }}
      >
        <div className="absolute inset-0" style={leaf("left")} />
        <div className="absolute inset-0" style={leaf("right")} />
      </div>
    </div>
  )
}
