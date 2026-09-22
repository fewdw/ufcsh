import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
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
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
