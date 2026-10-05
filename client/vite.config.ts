import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const previewOrigin = process.env.UFC_PREVIEW_ORIGIN;
const apiTarget = `http://127.0.0.1:${process.env.UFC_PREVIEW_API_PORT || "8000"}`;

export default defineConfig({
  envDir: previewOrigin ? fileURLToPath(new URL("../.local-preview/vite-env", import.meta.url)) : undefined,
  // Shown by the dev-only stats overlay, to tell a stale bundle from a new one.
  define: { "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()) },
  plugins: [
    {
      name: "site-origin-html",
      transformIndexHtml(html) {
        return html.replaceAll("__SITE_ORIGIN__", (process.env.VITE_SITE_ORIGIN || "https://ufc.sh").replace(/\/$/, ""));
      },
    },
    react(), tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: previewOrigin ? [new URL(previewOrigin).hostname] : [],
    ws: previewOrigin?.startsWith("https:") ? {
      protocol: "wss", host: new URL(previewOrigin).hostname,
      clientPort: Number(new URL(previewOrigin).port || 443),
    } : undefined,
    // Keep the dev server inside client/, including when another worktree is nearby.
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
    proxy: {
      "/api": apiTarget,
      "/og": apiTarget,
      "/readyz": apiTarget,
      "/healthz": apiTarget,
      "/sitemap.xml": apiTarget,
    },
  },
});
