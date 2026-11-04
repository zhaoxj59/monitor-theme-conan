/**
 * Dismissing the shell splash (the inlined watch photograph in
 * index.html). The app decides how it leaves, once the theme config has
 * landed and it knows whether an intro follows: when the doors are about
 * to play, the splash fades into them; when every animation is off, it
 * is removed in the same frame it is dismissed, with no fade at all, so
 * a refresh lands on the page itself with nothing moving on the way.
 * Idempotent -- a splash already gone stays gone.
 */
export function dismissSplash(instant: boolean): void {
  const splash = document.getElementById("conan-splash")
  if (!splash) return
  if (instant) {
    splash.remove()
    return
  }
  splash.classList.add("away")
  setTimeout(() => splash.remove(), 500)
}
