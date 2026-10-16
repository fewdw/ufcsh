import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useApi, type LiveCard, type Matchup } from "../api";
import { lastName } from "../format";
import { decimalScore, type ScoreSummary } from "../scoring";

/**
 * The fans' live scorecard as a stream overlay: a page with nothing behind
 * it, for a browser source in OBS or any streaming tool. `/overlay` follows
 * whichever bout the card is on; `/overlay/:fightId` holds one bout.
 * `?theme=light` swaps the dark card for a light one and `?scale=1.5` sizes
 * it up without blurring. Colours are its own, not the site's theme, since a
 * streaming tool's browser has no saved settings.
 */

const THEMES = {
  dark: { card: "rgba(9, 9, 11, 0.86)", border: "rgba(255, 255, 255, 0.1)", text: "#fafafa", muted: "#a1a1aa", faint: "#52525b", f1: "#93c5fd", f2: "#fca5a5", live: "#34d399" },
  light: { card: "rgba(255, 255, 255, 0.92)", border: "rgba(9, 9, 11, 0.1)", text: "#09090b", muted: "#52525b", faint: "#a1a1aa", f1: "#1e40af", f2: "#991b1b", live: "#047857" },
} as const;
type Theme = (typeof THEMES)[keyof typeof THEMES];

export default function OverlayPage() {
  const { fightId } = useParams();
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const theme = THEMES[params.get("theme") === "light" ? "light" : "dark"];
  const scale = Math.min(4, Math.max(0.5, Number(params.get("scale")) || 1));

  // A browser source draws only what the page paints: nothing behind the card.
  useEffect(() => {
    const root = document.documentElement;
    const previous = [root.style.background, document.body.style.background, root.style.colorScheme];
    root.style.background = "transparent";
    document.body.style.background = "transparent";
    root.style.colorScheme = "normal";
    return () => { [root.style.background, document.body.style.background, root.style.colorScheme] = previous; };
  }, []);

  return (
    <div style={{ padding: 8 * scale, fontFamily: "inherit" }}>
      <div style={{ zoom: scale } as React.CSSProperties}>
        {fightId ? <PinnedBout id={fightId} theme={theme} /> : <FollowCard theme={theme} />}
      </div>
    </div>
  );
}

/** The overlay drawn in place, for the Score tab's dialog. Not framed: the
 *  site refuses to be framed, its own pages included. */
export function OverlayPreview({ fightId }: { fightId: string }) {
  return <div style={{ zoom: 0.7 } as React.CSSProperties}><PinnedBout id={fightId} theme={THEMES.dark} /></div>;
}

/** Whichever bout the card is on now, changing over as each one ends. */
function FollowCard({ theme }: { theme: Theme }) {
  const { data } = useApi<LiveCard | null>("/api/live", 15_000);
  if (!data) return <Shell theme={theme}><p style={{ margin: 0, fontSize: 13, color: theme.muted }}>Waiting for the next UFC card</p></Shell>;
  const { fight } = data;
  return <Board id={fight.id} names={[fight.f1.name, fight.f2.name]} live={data.live} theme={theme} />;
}

function PinnedBout({ id, theme }: { id: string; theme: Theme }) {
  const { data } = useApi<Matchup>(`/api/fights/${id}`);
  if (!data) return null;
  return <Board id={id} names={[data.f1.name, data.f2.name]} live={Boolean(data.in_progress)} theme={theme} />;
}

function Shell({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-block", minWidth: 300, borderRadius: 14, padding: "10px 14px 12px", background: theme.card, border: `1px solid ${theme.border}`, color: theme.text, fontVariantNumeric: "tabular-nums" }}>
      {children}
    </div>
  );
}

function Board({ id, names, live, theme }: { id: string; names: [string, string]; live: boolean; theme: Theme }) {
  const { data } = useApi<ScoreSummary>(`/api/fights/${id}/scores`, 5_000);
  const eligibility = data?.eligibility;
  const rounds = eligibility?.scheduled || 3;
  const available = eligibility?.available ?? 0;
  const closed = Math.min(data?.closed ?? available, available);
  // The round being fought stays hidden from everyone until it ends.
  const fighting = eligibility?.state === "live" && available > closed ? closed + 1 : null;
  const scorers = data?.totals.scorers ?? 0;
  const head: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: theme.muted, textAlign: "center", padding: "0 6px 4px" };
  const cell: React.CSSProperties = { fontSize: 16, textAlign: "center", padding: "3px 6px", minWidth: 42 };
  return (
    <Shell theme={theme}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 6, fontSize: 11, color: theme.muted }}>
        <span><strong style={{ color: theme.text, letterSpacing: "0.04em" }}>UFC.sh</strong> fan scorecard{scorers ? ` · ${scorers.toLocaleString()} ${scorers === 1 ? "fan" : "fans"}` : ""}</span>
        {live || eligibility?.state === "live" ? <span style={{ fontWeight: 700, letterSpacing: "0.14em", color: theme.live }}>● LIVE</span> : null}
      </div>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th />
            {Array.from({ length: rounds }, (_, index) => <th key={index} style={head}>R{index + 1}</th>)}
            <th style={head}>Total</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as const).map((side) => {
            const ink = side === 0 ? theme.f1 : theme.f2;
            const lead = (mine: number | null | undefined, theirs: number | null | undefined) =>
              mine != null && theirs != null && mine > theirs ? { color: ink, fontWeight: 700 } : { color: theme.muted };
            const total = side === 0 ? [data?.totals.avg1, data?.totals.avg2] : [data?.totals.avg2, data?.totals.avg1];
            return (
              <tr key={side} style={{ borderTop: side ? `1px solid ${theme.border}` : undefined }}>
                <td style={{ fontSize: 15, fontWeight: 700, color: ink, paddingRight: 10, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.02em" }}>{lastName(names[side])}</td>
                {Array.from({ length: rounds }, (_, index) => {
                  const round = index + 1;
                  if (round === fighting) return <td key={index} style={{ ...cell, color: theme.faint, fontSize: 13 }} title="Hidden until the round ends">•••</td>;
                  const row = data?.rounds.find((entry) => entry.round === round);
                  const [mine, theirs] = side === 0 ? [row?.total1, row?.total2] : [row?.total2, row?.total1];
                  if (mine == null) return <td key={index} style={{ ...cell, color: theme.faint }}>–</td>;
                  return <td key={index} style={{ ...cell, ...lead(mine, theirs) }}>{decimalScore(mine)}</td>;
                })}
                <td style={{ ...cell, fontSize: 19, paddingLeft: 10, ...lead(total[0], total[1]) }}>{total[0] == null ? "–" : decimalScore(total[0])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}
