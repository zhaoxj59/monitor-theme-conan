import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App.tsx"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The shell's splash (see index.html) hands over to the app: two frames so
// the first commit -- door layer and all -- is painted underneath before
// the fade begins, and the watch photograph dissolves into the doors
// rather than cutting to them. The 6s timer in the shell is the backstop
// for a bundle that never gets this far.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById("conan-splash")
    if (!splash) return
    splash.classList.add("away")
    setTimeout(() => splash.remove(), 500)
  })
})
