import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ./start runs each worktree's API on its own port.
const api = `http://127.0.0.1:${process.env.PORT || 8000}`;

export default defineConfig({
  // Shown by the dev-only stats overlay, to tell a stale bundle from a new one.
  define: { "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()) },
  plugins: [
    {
      name: "site-origin-html",
      transformIndexHtml(html) {
        return html.replaceAll("__SITE_ORIGIN__", (process.env.VITE_SITE_ORIGIN || "https://ufc.sh").replace(/\/$/, ""));
      },
    },
    {
      // A page's code is otherwise asked for only once the main bundle has
      // arrived and run. This lists each page's chunks for index.html, which
      // asks for the opening page's at once; `pageFor` in src/pages.ts is the
      // same mapping.
      name: "first-page-preload",
      transformIndexHtml: {
        order: "post",
        handler(html, { bundle }) {
          if (!bundle) return html.replace("__PAGE_CHUNKS__", "{}");
          const chunks = new Map<string, { imports: string[] }>();
          for (const output of Object.values(bundle)) if (output.type === "chunk") chunks.set(output.fileName, output);
          const closure = (file: string, into = new Set<string>()) => {
            if (!into.has(file)) { into.add(file); for (const next of chunks.get(file)?.imports ?? []) closure(next, into); }
            return into;
          };
          const entry = new Set<string>();
          for (const output of Object.values(bundle)) if (output.type === "chunk" && output.isEntry) closure(output.fileName, entry);
          const pages: Record<string, string[]> = {};
          for (const output of Object.values(bundle)) {
            const page = output.type === "chunk" && /\/src\/pages\/(\w+)\.tsx$/.exec(output.facadeModuleId ?? "")?.[1];
            // Only the pages index.html names, as "assets/<name>.js" → "<name>".
            if (page && html.includes(`"${page}"`)) {
              pages[page] = [...closure(output.fileName)].filter(file => !entry.has(file)).map(file => file.replace(/^assets\/(.*)\.js$/, "$1"));
            }
          }
          return html.replace("__PAGE_CHUNKS__", JSON.stringify(pages));
        },
      },
    },
    react(), tailwindcss(),
  ],
  server: {
    // Private Tailscale preview hostnames; the dev server itself stays on loopback.
    allowedHosts: [".ts.net"],
    proxy: { "/api": api, "/og": api, "/readyz": api },
  },
});
