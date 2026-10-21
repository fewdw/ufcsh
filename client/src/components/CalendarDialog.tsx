import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, CalendarPlus, CalendarSync, Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
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
type Range = "upcoming" | "all";
type CalendarEvent = { id: string; name: string; schedule?: CardSchedule };

const START_OPTIONS: { value: CardSegment; label: string }[] = [
  { value: "early", label: "Full card" },
  { value: "prelims", label: "Prelims + main" },
  { value: "main", label: "Main card" },
];
const ORDER: CardSegment[] = ["early", "prelims", "main"];
const parseStart = oneOf<CardSegment>("early", "prelims", "main");

const startOf = (schedule: CardSchedule | undefined, segment: CardSegment): number | null =>
  segment === "main" ? schedule?.main_card_at ?? null
    : segment === "prelims" ? schedule?.prelims_at ?? null
      : schedule?.early_prelims_at ?? null;

/** iPhone, iPad and Mac readers see Apple Calendar first; everyone else Google. */
const appleDevice = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);

/** The feed's address, defaults left out (the server's `calendarQuery`). */
function feedPath(cards: Cards, from: CardSegment, events: Range): string {
  const params = new URLSearchParams();
  if (cards !== "all") params.set("cards", cards);
  if (from !== "early") params.set("from", from);
  if (events !== "upcoming") params.set("events", events);
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

/** One way into a calendar app: a row with the app's name and what it does. */
function Action({ href, title, detail, color, download, newTab }: {
  href: string; title: string; detail: string; color: string; download?: string; newTab?: boolean;
}) {
  return <a href={href} download={download} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}
    className="group flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100">
      <CalendarDays className="h-5 w-5" style={{ color }} aria-hidden="true" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-zinc-900">{title}</span>
      <span className="block text-xs leading-4 text-zinc-500">{detail}</span>
    </span>
    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-600" aria-hidden="true" />
  </a>;
}

const APPLE = "#ff3b30";
const GOOGLE = "#1a73e8";
const OUTLOOK = "#0078d4";
const OTHER = "#71717a";

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
  const apple = <Action key="apple" href={file} title="Apple Calendar" detail="iPhone, iPad and Mac" color={APPLE} />;
  const google = <Action key="google" href={`/cal/events/${event.id}/google${query}`} newTab title="Google Calendar" detail="Opens Google Calendar to save it" color={GOOGLE} />;
  return <div className="space-y-4 px-5 py-4">
    {options.length > 1 ? <Segmented label="Include" value={from} options={options} onChange={choose} /> : null}
    {start != null ? <p className="text-xs text-zinc-500">
      Starts <span className="font-medium text-zinc-800">{day}, {clockTimeWithZone(start)}</span>, with every bout listed in the event.
    </p> : null}
    <div className="space-y-2">
      {appleDevice() ? [apple, google] : [google, apple]}
      <Action href={file} download="" title="Outlook and others" detail="An .ics file for any calendar app" color={OTHER} />
    </div>
    <button type="button" onClick={onSubscribe}
      className="flex w-full items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-left transition hover:bg-zinc-100">
      <CalendarSync className="h-5 w-5 shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900">Get every card automatically</span>
        <span className="block text-xs leading-4 text-zinc-500">Subscribe to a UFC calendar that adds and updates cards for you</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
    </button>
  </div>;
}

function SubscribePanel({ kind }: { kind: Cards }) {
  const [cards, setCards] = useState<Cards>(kind);
  const [from, setFrom] = useState<CardSegment>(() => readPreference<CardSegment>("calendar:from", "early", parseStart));
  const [events, setEvents] = useState<Range>(() => readPreference<Range>("calendar:events", "upcoming", oneOf<Range>("upcoming", "all")));
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { writePreference("calendar:from", from, "early"); }, [from]);
  useEffect(() => { writePreference("calendar:events", events, "upcoming"); }, [events]);
  useEffect(() => { setCopied(false); }, [cards, from, events]);

  const path = feedPath(cards, from, events);
  const https = `${window.location.origin}${path}`;
  const webcal = `webcal://${window.location.host}${path}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(https); }
    catch { input.current?.select(); return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const apple = <Action key="apple" href={webcal} title="Apple Calendar" detail="Subscribe on iPhone, iPad or Mac" color={APPLE} />;
  const google = <Action key="google" href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`} newTab
    title="Google Calendar" detail="Adds it to your Google account, synced to every device" color={GOOGLE} />;
  return <div className="space-y-4 px-5 py-4">
    <Segmented label="Cards" value={cards} onChange={setCards} options={[
      { value: "all", label: "All" }, { value: "ppv", label: "PPV" }, { value: "fight_night", label: "Fight Nights" },
    ]} />
    <div>
      <Segmented label="Include" value={from} onChange={setFrom} options={START_OPTIONS} />
      <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">A card without early prelims starts with its prelims.</p>
    </div>
    <div>
      <Segmented label="Events" value={events} onChange={setEvents} options={[
        { value: "upcoming", label: "Upcoming" }, { value: "all", label: "Upcoming + past" },
      ]} />
      <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">
        {events === "upcoming" ? "Keeps the last two months too, so a card you just watched stays put." : "Every card since 2011 with announced start times."}
      </p>
    </div>
    <div className="space-y-2">
      {appleDevice() ? [apple, google] : [google, apple]}
      <Action href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=UFC`} newTab
        title="Outlook" detail="Outlook.com and Microsoft 365" color={OUTLOOK} />
    </div>
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
function CalendarDialog({ open, onClose, event, kind = "all" }: {
  open: boolean; onClose: () => void; event?: CalendarEvent; kind?: Cards;
}) {
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
      {showCard ? <CardPanel event={event!} onSubscribe={() => setSubscribe(true)} /> : <SubscribePanel kind={kind} />}
    </> : null}
  </dialog>;
}

/** "Add to calendar", beside a card's date and place. */
export function AddToCalendarButton({ event }: { event: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
      <CalendarPlus className="h-3.5 w-3.5 self-center" aria-hidden="true" />
      Add to calendar
    </button>
    <CalendarDialog open={open} onClose={() => setOpen(false)} event={event} />
  </>;
}

/** The subscription, from the events list; it starts on the tier being read. */
export function SubscribeCalendarButton({ kind, className = "", children }: { kind: Cards; className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Subscribe to the UFC calendar" title="Subscribe to the UFC calendar" className={className}>
      {children ?? <CalendarSync className={CLOSE_ICON} aria-hidden="true" />}
    </button>
    <CalendarDialog open={open} onClose={() => setOpen(false)} kind={kind} />
  </>;
}
