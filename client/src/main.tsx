import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { SettingsProvider } from "./settings";
import { ParlayProvider } from "./parlay";

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
