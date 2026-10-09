import { useState } from "react";
import { useAdminRequest, useAdminResource } from "../admin";
import { relativeAge } from "../format";
import { SwitchRow } from "./OptionsSheet";

type NewsAi = { on: boolean; configured: boolean; read_at: number | null; error: string | null; tokens: number };

/** Gemini on /news, and the switch that turns it off: off, nothing is sent
 *  and the page shows every story as the feeds built it, without summaries. */
export default function AdminNewsAi() {
  const request = useAdminRequest();
  const { data, setData } = useAdminResource<NewsAi>("/api/admin/news-ai", 60_000);
  const [failed, setFailed] = useState<string | null>(null);
  if (!data) return null;
  const set = async (on: boolean) => {
    setFailed(null);
    try { setData(await request<NewsAi>("/api/admin/news-ai", { method: "PUT", body: { on } })); }
    catch (err) { setFailed(err instanceof Error ? err.message : String(err)); }
  };
  const state = !data.on ? "Off: no AI requests. News uses the feeds, without AI filtering or summaries."
    : !data.configured ? "No AI key configured. News keeps updating from feeds."
      : data.error ? `AI unavailable. News keeps updating from feeds; previous AI results are retained. ${data.error}`
        : data.read_at ? `Last read ${relativeAge(data.read_at)} · ${data.tokens.toLocaleString()} tokens so far` : "Waiting for its first pass.";
  return (
    <section className="rounded-xl border border-line bg-surface px-1.5 py-1.5">
      <SwitchRow label="News AI (Gemini)" hint={failed ?? state} on={data.on} onChange={(on) => void set(on)} />
    </section>
  );
}
