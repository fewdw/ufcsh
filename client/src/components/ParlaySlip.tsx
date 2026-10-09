import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/react";
import { Check, ChevronDown, Ticket, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { MAX_STAKE, MIN_STAKE, useParlay, parlayPayout, formatCombinedPrice } from "../parlay";
import { formatPrice } from "../methodOdds";
import { accountsEnabled, useAccount } from "../auth";
import { BetError, placeBet } from "../bets";
import { useSettings } from "../settings";
import { BUTTON_PRIMARY } from "../ui";

/** Digits and at most one decimal point, with redundant leading zeros
 *  collapsed as they're typed — "0001" never sits in the field, only "1". A
 *  lone "0" (or "0." mid-entry) survives, since it's still valid on the way
 *  to a real number. */
function sanitizeStake(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
  return cleaned.replace(/^0+(?=\d)/, "");
}

/** Saves the slip to the reader's profile and settles it against the real
 *  result. The server prices it from its own board. */
function AddToProfile() {
  const { legs, stake, reprice, markPlaced } = useParlay();
  const { getToken } = useAuth();
  const { user, signIn } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tooSmall = stake < MIN_STAKE;
  const submit = async () => {
    if (!user) { signIn(); return; }
    setBusy(true); setError("");
    try {
      const token = await getToken();
      if (!token) throw new BetError("Your session expired. Sign in again.");
      await placeBet(token, Math.round(stake * 100) / 100, legs.map((leg) => ({ outcome: leg.outcome, price: leg.price })));
      markPlaced(true);
    } catch (err) {
      if (err instanceof BetError && err.changed.length) reprice(err.changed);
      setError(err instanceof Error ? err.message : "That bet could not be placed.");
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <button type="button" onClick={() => void submit()} disabled={busy || tooSmall}
        className={`${BUTTON_PRIMARY} w-full`}>
        {busy ? "Adding…" : user ? "Add to profile" : "Sign in to add to profile"}
      </button>
      {error ? <p role="alert" className="text-[11px] leading-snug text-danger">{error}</p>
        : <p className="text-[10px] leading-snug text-muted">{tooSmall ? `Minimum stake $${MIN_STAKE}.` : "You can remove a bet until a matchup on it closes."}</p>}
    </div>
  );
}

/** The parlay slip, portalled to the body so it persists across pages;
 * closing collapses it to a pill because the picks are still live. */
export default function ParlaySlip() {
  const { legs, stake, open, conflict, placed, remove, clear, setOpen, setStake, dismissConflict, markPlaced } = useParlay();
  const { settings } = useSettings();
  const [stakeText, setStakeText] = useState(() => String(stake));
  if (!legs.length && placed) return createPortal(
    <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 text-sm shadow-2xl" role="status">
      <Check className="h-4 w-4 text-success" aria-hidden="true" />
      <span className="font-medium text-foreground">Added to your profile</span>
      <Link to="/profiles/me?tab=bets" onClick={() => markPlaced(false)} className="rounded-full bg-surface-strong px-2.5 py-0.5 text-xs font-medium text-foreground hover:bg-track">View</Link>
      <button type="button" onClick={() => markPlaced(false)} aria-label="Dismiss" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-strong hover:text-foreground">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
  if (!legs.length) return null;
  const { combinedDecimal, payout, profit } = parlayPayout(legs, stake);
  const combinedPrice = formatCombinedPrice(combinedDecimal, settings.oddsFormat);

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-2" role="region" aria-label="Parlay slip">
      {open ? (
        <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-muted" aria-hidden="true" />
              <h2 className="text-sm font-medium text-foreground">Parlay · {legs.length} {legs.length === 1 ? "leg" : "legs"}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setOpen(false)} aria-label="Minimize parlay slip" title="Minimize" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-strong hover:text-foreground">
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={clear} aria-label="Clear parlay" title="Clear parlay" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-strong hover:text-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {conflict ? (
            <div className="flex items-start gap-2 border-b border-line-subtle bg-warning-subtle px-4 py-2.5 text-[11px] leading-snug text-warning">
              <span className="flex-1">{conflict}</span>
              <button type="button" onClick={dismissConflict} aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-warning transition hover:bg-warning-subtle">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <ul className="flex max-h-64 flex-col divide-y divide-line-subtle overflow-y-auto">
            {legs.map((leg) => (
              <li key={leg.id} className="flex items-start gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-muted">{leg.fightLabel}</div>
                  <div className="truncate text-xs font-medium text-foreground">{leg.selection}</div>
                  <div className="truncate text-[11px] text-muted">{leg.market}</div>
                </div>
                <span className="shrink-0 pt-px text-xs font-medium tabular-nums text-foreground">{formatPrice(leg.price, settings.oddsFormat)}</span>
                <button type="button" onClick={() => remove(leg.id)} aria-label={`Remove ${leg.selection}`} className="shrink-0 rounded p-1 text-faint transition hover:bg-surface-strong hover:text-secondary">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 border-t border-line-subtle bg-surface-muted px-4 py-3">
            <label className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
              <span>Stake <span className="font-normal text-muted">· max ${MAX_STAKE}</span></span>
              <span className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1">
                <span className="text-muted">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={stakeText}
                  onChange={(event) => {
                    let cleaned = sanitizeStake(event.target.value);
                    const parsed = Number.parseFloat(cleaned);
                    if (parsed > MAX_STAKE) cleaned = String(MAX_STAKE);
                    setStakeText(cleaned);
                    if (Number.isFinite(parsed)) setStake(Math.min(parsed, MAX_STAKE));
                  }}
                  className="w-16 bg-transparent text-right text-sm font-medium tabular-nums text-foreground outline-none"
                  aria-label="Stake amount"
                />
              </span>
            </label>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Parlay price</span>
              <span className="font-medium tabular-nums text-foreground">{combinedPrice}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">To win</span>
              <span className="font-medium tabular-nums text-success">${profit.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>Total payout</span>
              <span className="tabular-nums">${payout.toFixed(2)}</span>
            </div>
            {accountsEnabled ? <AddToProfile /> : null}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-2xl transition hover:border-line-strong hover:shadow-[0_20px_40px_-16px_rgb(0_0_0/0.35)]">
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 py-0.5 pr-2 text-sm font-medium text-foreground">
            <Ticket className="h-4 w-4 text-muted" aria-hidden="true" />
            <span>Parlay · {legs.length} {legs.length === 1 ? "leg" : "legs"}</span>
            <span className="rounded-full bg-surface-strong px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">{combinedPrice}</span>
          </button>
          <span className="h-5 w-px shrink-0 bg-track" aria-hidden="true" />
          <button type="button" onClick={clear} aria-label="Clear parlay" title="Clear parlay" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-strong hover:text-foreground">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
