import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { pageFor } from "./pages";
import { AuthProvider } from "./auth";
import { SettingsProvider } from "./settings";
import { ParlayProvider } from "./parlay";

// iOS zooms the page in whenever a field under 16px is focused, and leaves it
// there. A maximum scale stops that; iOS still lets the reader pinch-zoom, so
// only iOS gets it — elsewhere it would lock zooming out entirely.
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
}

// The first page's code is asked for before the first render — it is usually
// already cached — so the shell and the page appear together rather than the
// shell and a loading line. A slow network waits at most a moment.
const firstPage = pageFor(window.location.pathname);
await Promise.race([firstPage?.().catch(() => {}), new Promise(resolve => setTimeout(resolve, 300))]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <AuthProvider>
        <ParlayProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ParlayProvider>
      </AuthProvider>
    </SettingsProvider>
  </StrictMode>,
);
