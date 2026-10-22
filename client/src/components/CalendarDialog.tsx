import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import type { CardSchedule, CardSegment } from "../api";
import { clockTimeWithZone } from "../format";
import { oneOf, readPreference, writePreference } from "../preferences";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import { segmentedIdle, segmentedSelected } from "./segmented";

/**
 * Cards in the reader's calendar app. One card, from the section they choose,
 * as a Google Calendar event or an .ics file (`/cal/events/:id.ics`); or every
 * card as a subscription (`/cal/ufc.ics`), a calendar of its own named "UFC"
 * that the app keeps up to date as bouts and start times are announced. The
 * server builds both (server/src/calendar.ts); this only picks the options.
 */

type Cards = "all" | "ppv" | "fight_night";
/** A subscription runs from the full card or the main card. */
type FeedStart = Extract<CardSegment, "early" | "main">;
type CalendarEvent = { id: string; name: string; schedule?: CardSchedule };

const START_OPTIONS: { value: CardSegment; label: string }[] = [
  { value: "early", label: "Full card" },
  { value: "prelims", label: "Prelims + main" },
  { value: "main", label: "Main card" },
];
const ORDER: CardSegment[] = ["early", "prelims", "main"];
const parseStart = oneOf<CardSegment>("early", "prelims", "main");
const parseFeedStart = oneOf<FeedStart>("early", "main");

const startOf = (schedule: CardSchedule | undefined, segment: CardSegment): number | null =>
  segment === "main" ? schedule?.main_card_at ?? null
    : segment === "prelims" ? schedule?.prelims_at ?? null
      : schedule?.early_prelims_at ?? null;

/** iPhone, iPad and Mac readers see Apple Calendar first; everyone else Google. */
const appleDevice = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

/** The feed's address, defaults left out (the server's `calendarQuery`). */
function feedPath(cards: Cards, from: FeedStart): string {
  const params = new URLSearchParams();
  if (cards !== "all") params.set("cards", cards);
  if (from !== "early") params.set("from", from);
  const query = params.toString();
  return `/cal/ufc.ics${query ? `?${query}` : ""}`;
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string; detail?: string | null }[]; onChange: (value: T) => void;
}) {
  return <div>
    <div className="mb-1.5 text-xs font-medium text-zinc-700">{label}</div>
    <div className="flex items-stretch gap-1 rounded-2xl bg-zinc-100 p-1" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
          className={`flex min-h-9 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1.5 py-1.5 text-center text-[13px] font-medium leading-tight transition sm:text-xs ${
            value === option.value ? segmentedSelected : segmentedIdle}`}>
          <span>{option.label}</span>
          {option.detail ? <span className="mt-0.5 text-[11px] font-normal tabular-nums text-zinc-500">{option.detail}</span> : null}
        </button>
      ))}
    </div>
  </div>;
}

/** The apps' own marks: Google's G, Apple's apple (in the text color, so it
 *  turns white in dark mode) and Outlook's, all from their brand assets. */
function GoogleLogo() {
  return <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>;
}

function AppleLogo() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-900" fill="currentColor" aria-hidden="true">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>;
}

function OutlookLogo() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#0078D4" aria-hidden="true">
    <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V10.85l1.24.72h.01q.1.07.18.18.07.12.07.25zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z" />
  </svg>;
}

/** One calendar app: its mark at the left, its name centred. */
function Action({ href, logo, title, download, newTab }: {
  href: string; logo: ReactNode; title: string; download?: string; newTab?: boolean;
}) {
  return <a href={href} download={download} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}
    className="relative flex min-h-11 items-center justify-center rounded-xl px-12 py-2 text-center text-sm font-medium text-zinc-900 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
    <span className="absolute left-3.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center">{logo}</span>
    {title}
  </a>;
}

/** Google, Apple and Outlook, Apple first on Apple's own devices. */
function Actions({ google, apple, outlook }: { google: ReactNode; apple: ReactNode; outlook: ReactNode }) {
  return <div className="space-y-2">{appleDevice() ? <>{apple}{google}</> : <>{google}{apple}</>}{outlook}</div>;
}

function CardPanel({ event, onSubscribe }: { event: CalendarEvent; onSubscribe: () => void }) {
  // Only the sections this card has times for; without early prelims the
  // prelims are its full card.
  const options = ORDER.filter((segment) => startOf(event.schedule, segment) != null)
    .map((segment, index) => ({
      value: segment,
      label: index === 0 ? "Full card" : START_OPTIONS.find((option) => option.value === segment)!.label,
      detail: clockTimeWithZone(startOf(event.schedule, segment)),
    }));
  const remembered = readPreference<CardSegment>("calendar:from", "early", parseStart);
  const [from, setFrom] = useState<CardSegment>(() =>
    options.find((option) => ORDER.indexOf(option.value) >= ORDER.indexOf(remembered))?.value ?? options[0]?.value ?? "main");
  const choose = (value: CardSegment) => {
    setFrom(value);
    writePreference("calendar:from", value === options[0]?.value ? "early" : value, "early");
  };
  const start = startOf(event.schedule, from);
  const day = start == null ? null : new Date(start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const query = `?from=${from}`;
  const file = `/cal/events/${event.id}.ics${query}`;
  return <div className="space-y-4 px-5 py-4">
    {options.length > 1 ? <Segmented label="Include" value={from} options={options} onChange={choose} /> : null}
    {start != null ? <p className="text-xs text-zinc-500">
      Starts <span className="font-medium text-zinc-800">{day}, {clockTimeWithZone(start)}</span>, with every bout listed in the event.
    </p> : null}
    <div>
      <Actions
        google={<Action href={`/cal/events/${event.id}/google${query}`} newTab logo={<GoogleLogo />} title="Google Calendar" />}
        apple={<Action href={file} logo={<AppleLogo />} title="Apple Calendar" />}
        outlook={<Action href={file} download="" logo={<OutlookLogo />} title="Outlook" />} />
      <p className="mt-2 text-center text-[11px] leading-4 text-zinc-500">
        Another app? <a href={file} download="" className="font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900">Download the .ics file</a>
      </p>
    </div>
    <button type="button" onClick={onSubscribe}
      className="flex w-full items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-left transition hover:bg-zinc-100">
      <CalendarDays className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900">Get every card automatically</span>
        <span className="block text-xs leading-4 text-zinc-500">Subscribe to a UFC calendar that adds and updates cards for you</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
    </button>
  </div>;
}

function SubscribePanel() {
  const [cards, setCards] = useState<Cards>("all");
  const [from, setFrom] = useState<FeedStart>(() => readPreference<FeedStart>("calendar:from", "early", parseFeedStart));
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { writePreference("calendar:from", from, "early"); }, [from]);
  useEffect(() => { setCopied(false); }, [cards, from]);

  const path = feedPath(cards, from);
  const https = `${window.location.origin}${path}`;
  const webcal = `webcal://${window.location.host}${path}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(https); }
    catch { input.current?.select(); return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return <div className="space-y-4 px-5 py-4">
    <Segmented label="Cards" value={cards} onChange={setCards} options={[
      { value: "all", label: "All" }, { value: "ppv", label: "PPV" }, { value: "fight_night", label: "Fight Nights" },
    ]} />
    <Segmented label="Include" value={from} onChange={setFrom} options={[
      { value: "early", label: "Full card" }, { value: "main", label: "Main card" },
    ]} />
    <Actions
      google={<Action href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`} newTab logo={<GoogleLogo />} title="Google Calendar" />}
      apple={<Action href={webcal} logo={<AppleLogo />} title="Apple Calendar" />}
      outlook={<Action href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=UFC`} newTab logo={<OutlookLogo />} title="Outlook" />} />
    <div>
      <div className="mb-1.5 text-xs font-medium text-zinc-700">Or copy the link into any calendar app</div>
      <div className="flex items-center gap-2">
        <input ref={input} readOnly value={https} aria-label="Calendar link" onFocus={(event) => event.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 font-mono text-xs text-zinc-700 outline-none focus:border-zinc-400" />
        <button type="button" onClick={() => void copy()}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
    <p className="text-[11px] leading-4 text-zinc-500">
      New cards, bouts and start times arrive on your calendar app's own schedule: about hourly on Apple and Outlook, every few hours on Google.
      On Android, subscribe with Google Calendar in a browser and it syncs to the app.
    </p>
  </div>;
}

/** The dialog: one card when `event` is given (with a way on to the
 *  subscription), else the subscription. */
function CalendarDialog({ open, onClose, event }: { open: boolean; onClose: () => void; event?: CalendarEvent }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [subscribe, setSubscribe] = useState(!event);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setSubscribe(!event);
      node.showModal();
    } else if (!open && node.open) node.close();
  }, [open, event]);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const showCard = Boolean(event) && !subscribe;
  return <dialog ref={dialog} onCancel={(e) => { e.preventDefault(); close(); }}
    onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    aria-labelledby="calendar-dialog-title"
    className="search-dialog fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100%-1.5rem))] max-w-none overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl">
    {open ? <>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-100 bg-white px-5 py-3.5">
        {event && subscribe ? (
          <button type="button" onClick={() => setSubscribe(false)} aria-label="Back to this card" className={`-ml-2 ${CLOSE_BUTTON}`}>
            <ChevronLeft className={CLOSE_ICON} aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 id="calendar-dialog-title" className={DIALOG_TITLE}>{showCard ? "Add to calendar" : "Subscribe to UFC"}</h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {showCard ? event!.name : "Every card in a calendar of its own, kept up to date"}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close" className={`-mr-2 ${CLOSE_BUTTON}`}>
          <X className={CLOSE_ICON} aria-hidden="true" />
        </button>
      </div>
      {showCard ? <CardPanel event={event!} onSubscribe={() => setSubscribe(true)} /> : <SubscribePanel />}
    </> : null}
  </dialog>;
}

/** "Add to calendar", beside a card's date and place. */
export function AddToCalendarButton({ event }: { event: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex items-baseline gap-1 whitespace-nowrap rounded font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
      <CalendarPlus className="h-3.5 w-3.5 self-center" aria-hidden="true" />
      Add to calendar
    </button>
    <CalendarDialog open={open} onClose={() => setOpen(false)} event={event} />
  </>;
}

/** The subscription, from the events list and the profile. */
export function SubscribeCalendarButton({ className = "", children }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label={children ? undefined : "Subscribe to the UFC calendar"}
      title="Subscribe to the UFC calendar" className={className}>
      {children ?? <CalendarDays className={CLOSE_ICON} aria-hidden="true" />}
    </button>
    <CalendarDialog open={open} onClose={() => setOpen(false)} />
  </>;
}
