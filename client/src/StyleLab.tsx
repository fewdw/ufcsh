import { useEffect, useState } from "react";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/archivo";
import "./style-lab.css";

/** Candidate looks under review. "" is the app as it ships today. */
const STYLES = [
  { id: "", label: "Current" },
  { id: "broadcast", label: "1 Broadcast" },
  { id: "editorial", label: "2 Editorial" },
  { id: "terminal", label: "3 Terminal" },
  { id: "soft", label: "4 Soft" },
  { id: "brutal", label: "5 Brutalist" },
];
const KEY = "ufcsh:style-lab";

function initial() {
  const asked = new URLSearchParams(window.location.search).get("style");
  const byNumber = asked && /^[0-5]$/.test(asked) ? STYLES[Number(asked)].id : asked;
  const saved = byNumber ?? localStorage.getItem(KEY) ?? "";
  return STYLES.some(style => style.id === saved) ? saved : "";
}

function apply(id: string) {
  if (id) document.documentElement.dataset.style = id;
  else delete document.documentElement.dataset.style;
  localStorage.setItem(KEY, id);
}

// Before the first render, so the page never draws in one look and then another.
apply(initial());

/** The review switcher: a fixed bar that never takes a theme itself. */
export default function StyleLab() {
  const [current, setCurrent] = useState(initial);
  useEffect(() => apply(current), [current]);
  return (
    <div style={{
      position: "fixed", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 1000,
      display: "flex", gap: 2, padding: 3, maxWidth: "calc(100vw - 16px)", overflowX: "auto",
      borderRadius: 999, background: "rgb(17 17 17 / 0.92)", boxShadow: "0 8px 24px rgb(0 0 0 / 0.3)",
      font: "600 12px/1 ui-sans-serif, system-ui, sans-serif", letterSpacing: 0,
    }}>
      {STYLES.map(style => (
        <button key={style.id} type="button" aria-pressed={style.id === current} onClick={() => setCurrent(style.id)}
          style={{
            padding: "8px 12px", borderRadius: 999, whiteSpace: "nowrap", font: "inherit",
            background: style.id === current ? "#fff" : "transparent", color: style.id === current ? "#111" : "#d4d4d4",
          }}>
          {style.label}
        </button>
      ))}
    </div>
  );
}
