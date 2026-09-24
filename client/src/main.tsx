import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { SettingsProvider } from "./settings";
import { ParlayProvider } from "./parlay";

// iOS zooms the page in whenever a field under 16px is focused, and leaves it
// there. A maximum scale stops that; iOS still lets the reader pinch-zoom, so
// only iOS gets it — elsewhere it would lock zooming out entirely.
if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
  document.querySelector('meta[name="viewport"]')?.setAttribute("content", "width=device-width, initial-scale=1.0, maximum-scale=1.0");
}

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
