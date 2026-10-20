import { useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { MediaCard } from "../api";
import { lastName } from "../format";
import { mediaTally, verdictOf, VERDICTS, type Verdict } from "../mediaScores";
import { useHistoryState } from "../navigationState";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";

type Names = { f1: string; f2: string };
export type MediaScores = { name: string; url: string; cards: MediaCard[] };

const fill = (verdict: Verdict) => verdict === "draw" ? undefined : `var(--color-${verdict})`;
const ink = (verdict: Verdict) => verdict === "draw" ? undefined : `var(--color-${verdict}-ink)`;
// Draws are orange: neither fighter's colour, and not the grey of a losing score.
const DRAW_INK = "text-orange-600 dark:text-orange-400";
const verdictName = (verdict: Verdict, names: Names) => verdict === "draw" ? "Draw" : lastName(names[verdict]);

/** The cards' split as one bar: each fighter's colour, draws orange between. */
export function MediaBar({ cards, className = "" }: { cards: MediaCard[]; className?: string }) {
  const { counts } = mediaTally(cards);
  return (
    <span aria-hidden="true" className={`flex gap-px overflow-hidden rounded-full ${className}`}>
      {VERDICTS.map((verdict) => counts[verdict] ? (
        <span key={verdict} className={verdict === "draw" ? "bg-orange-400" : ""} style={{ flexGrow: counts[verdict], backgroundColor: fill(verdict) }} />
      ) : null)}
    </span>
  );
}

/** "Draw 12 · Murphy 5": each way the cards went, biggest first. */
export function MediaSplit({ cards, names, className = "" }: { cards: MediaCard[]; names: Names; className?: string }) {
  const { counts } = mediaTally(cards);
  const ways = VERDICTS.filter((verdict) => counts[verdict]).sort((a, b) => counts[b] - counts[a]);
  return (
    <span className={`tabular-nums ${className}`}>
      {ways.map((verdict, index) => (
        <span key={verdict} className="whitespace-nowrap">
          {index ? <span className="text-zinc-300"> · </span> : null}
          <span className={`font-semibold ${verdict === "draw" ? DRAW_INK : ""}`} style={{ color: ink(verdict) }}>{verdictName(verdict, names)}</span>{" "}
          <span className="font-semibold text-zinc-900">{counts[verdict]}</span>
        </span>
      ))}
    </span>
  );
}

function Score({ card }: { card: MediaCard }) {
  const verdict = verdictOf(card);
  const tone = (side: "f1" | "f2") => verdict === side ? { className: "font-semibold", style: { color: ink(side) } } : { className: verdict === "draw" ? `font-semibold ${DRAW_INK}` : "text-zinc-400" };
  return (
    <span className="tabular-nums">
      <span {...tone("f1")}>{card.f1Score}</span>
      <span className="px-0.5 text-zinc-300">–</span>
      <span {...tone("f2")}>{card.f2Score}</span>
    </span>
  );
}

/** Every journalist's card, grouped by score, the most common first. */
function MediaDialog({ id, media, names, close }: { id: string; media: MediaScores; names: Names; close: () => void }) {
  const byScore = new Map<string, MediaCard[]>();
  for (const card of media.cards) byScore.set(`${card.f1Score}-${card.f2Score}`, [...byScore.get(`${card.f1Score}-${card.f2Score}`) ?? [], card]);
  const groups = [...byScore.values()]
    .sort((a, b) => b.length - a.length || (b[0].f1Score - b[0].f2Score) - (a[0].f1Score - a[0].f2Score));
  const { counts } = mediaTally(media.cards);
  return (
    <EvidenceDialog id={id} close={close}>
      <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Media scores</h2>
          <button type="button" aria-label="Close media scores" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          {media.cards.length} {media.cards.length === 1 ? "card" : "cards"} from journalists, via{" "}
          <a href={media.url} target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{media.name}&nbsp;↗</a>
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {VERDICTS.map((verdict) => (
            <div key={verdict} className="min-w-0">
              <div className={`text-xl font-semibold tabular-nums leading-6 ${counts[verdict] ? verdict === "draw" ? DRAW_INK : "" : "text-zinc-300"}`} style={counts[verdict] ? { color: ink(verdict) } : undefined}>{counts[verdict]}</div>
              <div className="truncate text-[11px] text-zinc-500" title={verdict === "draw" ? undefined : names[verdict]}>{verdictName(verdict, names)}</div>
            </div>
          ))}
        </div>
        <MediaBar cards={media.cards} className="mt-2 h-1.5" />
      </div>
      <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-y-none px-4 pb-4 sm:px-5">
        {groups.map((group) => {
          const verdict = verdictOf(group[0]);
          return (
            <section key={`${group[0].f1Score}-${group[0].f2Score}`} className="border-t border-zinc-100 py-2.5">
              <h3 className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-baseline gap-2">
                  <Score card={group[0]} />
                  <span className={`text-xs font-medium ${verdict === "draw" ? DRAW_INK : ""}`} style={{ color: ink(verdict) }}>{verdict === "draw" ? "Draw" : lastName(names[verdict])}</span>
                </span>
                <span className="text-xs tabular-nums text-zinc-400">{group.length}</span>
              </h3>
              <ul className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-xs min-[440px]:grid-cols-2">
                {group.map((card, index) => {
                  const who = (
                    <>
                      <span className="font-medium text-zinc-900">{card.name || card.outlet}</span>
                      {card.name && card.outlet ? <span className="text-zinc-500"> · {card.outlet}</span> : null}
                    </>
                  );
                  return (
                    <li key={index} className="min-w-0 truncate leading-5">
                      {card.url ? (
                        <a href={card.url} target="_blank" rel="noopener noreferrer" title={`${card.name || card.outlet}'s card`} className="hover:underline">
                          {who}<span aria-hidden="true" className="text-zinc-400"> ↗</span>
                        </a>
                      ) : who}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </EvidenceDialog>
  );
}

/** The media cards' dialog, opened by whatever `children` renders. */
export function MediaDetails({ fightId, media, names, children }: { fightId: string; media: MediaScores; names: Names; children: (open: () => void) => React.ReactNode }) {
  const id = useId();
  // Link navigation keeps this entry open; only an explicit dismissal clears it.
  const [open, setOpen] = useHistoryState(`media:${fightId}:open`, false);
  return (
    <>
      {children(() => setOpen(true))}
      {open ? createPortal(<MediaDialog id={id} media={media} names={names} close={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
