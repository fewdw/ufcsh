import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LabsInsightsResponse } from "../api";
import { PANEL } from "./chartTokens";
import InfoTip from "./InfoTip";
import JudgesRoom from "./JudgesRoom";
import RoadToUFC from "./RoadToUFC";

/**
 * Two readings of the study the filters above already describe, in the same
 * shape as the combined record they sit under: a title, a line saying what the
 * section answers, and the numbers themselves.
 *
 * Both start open — a section that has to be unfolded before it says anything
 * is a section nobody reads — and both fold away, like the record above them,
 * for a reader who wants one of the three at a time.
 */
type CategoryKey = "judges" | "road";

const CATEGORIES: { key: CategoryKey; title: string; purpose: string; tip: string }[] = [
  {
    key: "judges",
    title: "The judges' room",
    purpose: "How the decisions in this study were scored, and by whom.",
    tip: "Only the final card is recorded at the source — there are no round-by-round scores. A card that reads against the statistics is not a wrong card: a round can be won without landing more or holding position longer.",
  },
  {
    key: "road",
    title: "The road to the UFC",
    purpose: "What these fighters arrived with, and what it was worth.",
    tip: "Counted only for fighters with an identity-verified professional history, so the coverage line matters: a fighter without one is left out rather than counted as having no bouts.",
  },
];

export default function LabsCategories({ data, loading, error, onRetry }: {
  data: LabsInsightsResponse | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [closed, setClosed] = useState<CategoryKey[]>([]);
  return (
    <div className="mt-3 space-y-3">
      {CATEGORIES.map((category) => {
        const open = !closed.includes(category.key);
        return (
          <section key={category.key} className={`${PANEL} overflow-hidden`} aria-label={category.title}>
            <button
              type="button"
              onClick={() => setClosed((current) => open ? [...current, category.key] : current.filter((key) => key !== category.key))}
              aria-expanded={open}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50/70 sm:px-5"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{category.title}</span>
                  <InfoTip>{category.tip}</InfoTip>
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">{category.purpose}</span>
              </span>
              <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
            </button>
            {open ? (
              <div className="border-t border-zinc-100 bg-zinc-50/50 p-3" aria-busy={loading}>
                {error && !data ? (
                  <p role="alert" className="py-8 text-center text-[11px] text-zinc-500">
                    Couldn’t read this study. <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
                  </p>
                ) : !data ? (
                  <p role="status" className="py-8 text-center text-[11px] text-zinc-400">{loading ? "Reading the study…" : "No data for this study."}</p>
                ) : (
                  <div className={loading ? "opacity-60 transition-opacity" : ""}>
                    {category.key === "judges" ? <JudgesRoom data={data} /> : <RoadToUFC data={data} />}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
