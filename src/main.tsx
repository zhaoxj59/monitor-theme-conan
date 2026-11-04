import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App.tsx"
import { dismissSplash } from "./lib/splash.ts"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The shell's splash (see index.html) stays up until App has read the
// theme config and knows whether the door intro follows it: App then
// dismisses it through lib/splash -- fading into the doors, or removed
// outright when every animation is off. This timer is only the backstop
// for a config that never lands, and the 6s timer in the shell covers a
// bundle that never gets this far; neither may leave the photograph
// standing as the page.
setTimeout(() => dismissSplash(false), 3000)
