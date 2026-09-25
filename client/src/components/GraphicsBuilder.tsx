import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronRight, Copy, Download, ImageIcon, Search, Share2, X } from "lucide-react";
import { useApi, type EventDetail, type EventListItem, type FighterBoard, type FighterProfile, type Matchup } from "../api";
import { buildEvent, buildFighter, buildMatchup, buildResult, photoUrl, togglesFor, type Kind, type PhotoMode, type Toggle } from "../graphics/build";
import { loadImage, renderGraphic, SIZES, type Format, type Graphic, type Photo, type Theme } from "../graphics/render";
import { graphicBlob } from "../graphics/export";
import type { GraphicSubject } from "../graphicsLauncher";
import { formatDateShortWithYear } from "../format";
import { landingEvent } from "../liveEvent";
import { useSettings, withRanking } from "../settings";
import { parseSearch, useSearch } from "../useSearch";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE, EYEBROW } from "../ui";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "./segmented";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "matchup", label: "Matchup", hint: "Tale of the tape, odds and how they fight" },
  { value: "result", label: "Fight result", hint: "Winner, method, totals and scorecards" },
  { value: "fighter", label: "Fighter", hint: "Record, measurements and rankings" },
  { value: "event", label: "Event card", hint: "Every bout with records and prices" },
];
const FIELD = "h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none hover:border-zinc-300 focus:border-zinc-400 sm:text-xs";
const canCopy = typeof window !== "undefined" && typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

type Subject = { kind: "fighter" | "fight" | "event"; id: string; label: string };

/** Pick what the graphic is about: a fighter, a bout or a card. */
function SubjectPicker({ kind, subject, onPick }: { kind: Kind; subject: Subject | null; onPick: (subject: Subject) => void }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const { data, searching } = useSearch(trimmed.length >= 2 ? `/api/search?q=${encodeURIComponent(trimmed)}` : null, parseSearch);
  const { data: events } = useApi<EventListItem[]>(kind === "event" ? "/api/events" : null);
  const wanted = kind === "fighter" ? "fighter" : kind === "event" ? "event" : "fight";
  const results: Subject[] = !trimmed ? [] : wanted === "fighter"
    ? (data?.fighters ?? []).map((fighter) => ({ kind: "fighter", id: fighter.id, label: `${fighter.name} · ${fighter.record}` }))
    : wanted === "fight"
      ? (data?.fights ?? []).map((fight) => ({ kind: "fight", id: fight.id, label: `${fight.f1_name} vs ${fight.f2_name} · ${formatDateShortWithYear(fight.date)}` }))
      : (data?.events ?? []).map((event) => ({ kind: "event", id: event.id, label: `${event.name} · ${formatDateShortWithYear(event.date)}` }));
  const recentEvents = wanted === "event" ? (events ?? []).slice(0, 16) : [];
  return (
    <div className="space-y-2">
      {subject && subject.kind === wanted ? (
        <p className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-[13px] font-medium text-zinc-900 ring-1 ring-inset ring-zinc-200">
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" /><span className="min-w-0 truncate">{subject.label}</span>
        </p>
      ) : null}
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 60))} autoComplete="off" spellCheck={false}
          placeholder={wanted === "fighter" ? "Find a fighter…" : wanted === "fight" ? "Find a bout, e.g. “Van vs Pantoja”…" : "Find an event…"}
          aria-label={wanted === "fighter" ? "Find a fighter" : wanted === "fight" ? "Find a bout" : "Find an event"}
          className={`${FIELD} pl-8`} />
      </label>
      {trimmed ? (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-zinc-100">
          {results.length ? results.map((result) => (
            <li key={result.id}>
              <button type="button" onClick={() => { onPick(result); setQuery(""); }} className="block w-full truncate px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 sm:text-xs">{result.label}</button>
            </li>
          )) : <li className="px-3 py-2 text-xs text-zinc-400">{searching ? "Searching…" : "Nothing found."}</li>}
        </ul>
      ) : recentEvents.length ? (
        <select value={subject?.kind === "event" ? subject.id : ""} aria-label="Recent and upcoming events" className={FIELD}
          onChange={(event) => { const found = events?.find((entry) => entry.id === event.target.value); if (found) onPick({ kind: "event", id: found.id, label: `${found.name} · ${formatDateShortWithYear(found.date)}` }); }}>
          <option value="">Recent and upcoming events…</option>
          {recentEvents.map((event) => <option key={event.id} value={event.id}>{event.name} · {formatDateShortWithYear(event.date)}</option>)}
        </select>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className={`${segmentedGroup} w-full`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
          className={`${segmentedOption} flex-1 ${value === option.value ? segmentedSelected : segmentedIdle}`}>{option.label}</button>
      ))}
    </div>
  );
}

/**
 * The graphics builder: choose a template and a subject, tick exactly what the
 * image should carry, pick a shape, then copy or download it. Everything is
 * drawn in the browser from data the site already serves, and every image
 * carries its source line, its date and the site's mark.
 */
export default function GraphicsBuilder({ initial, onClose }: { initial: GraphicSubject; onClose: () => void }) {
  const { settings } = useSettings();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "matchup");
  const [subject, setSubject] = useState<Subject | null>(initial
    ? { kind: initial.kind === "fighter" ? "fighter" : initial.kind === "event" ? "event" : "fight", id: initial.id, label: "" }
    : null);
  const [format, setFormat] = useState<Format>("square");
  // Dark reads best in a feed of photos; light is one click away.
  const [theme, setTheme] = useState<Theme>("dark");
  const [photoMode, setPhotoMode] = useState<PhotoMode>("none");
  const [scope, setScope] = useState("ufc");
  const [optionQuery, setOptionQuery] = useState("");
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [graphic, setGraphic] = useState<Graphic | null>(null);
  const [drawing, setDrawing] = useState(false);
  // On a phone the pinned preview lets go while the keyboard is up, so the field stays in view.
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  // With nothing chosen, start on the headline bout of the card the site opens on.
  const { data: events } = useApi<EventListItem[]>(subject ? null : "/api/events");
  const landing = events ? landingEvent(events) : undefined;
  const { data: landingCard } = useApi<EventDetail>(!subject && landing ? withRanking(`/api/events/${landing.id}`, settings.rankingSource) : null);
  useEffect(() => {
    if (subject || !landingCard?.fights.length) return;
    const main = landingCard.fights[0];
    setSubject({ kind: "fight", id: main.id, label: `${main.f1.name} vs ${main.f2.name} · ${landingCard.name}` });
  }, [landingCard, subject]);

  const fightId = subject?.kind === "fight" ? subject.id : null;
  const fighterId = subject?.kind === "fighter" ? subject.id : null;
  const eventId = subject?.kind === "event" ? subject.id : null;
  const fightRequest = useApi<Matchup>(fightId && (kind === "matchup" || kind === "result") ? withRanking(`/api/fights/${fightId}`, settings.rankingSource) : null);
  const fight = fightRequest.data?.id === fightId ? fightRequest.data : null;
  const { data: fightEvent } = useApi<EventDetail>(fight && kind === "matchup" ? withRanking(`/api/events/${fight.event.id}`, settings.rankingSource) : null);
  const fighterRequest = useApi<FighterProfile>(fighterId && kind === "fighter" ? withRanking(`/api/fighters/${fighterId}`, settings.rankingSource) : null);
  const fighter = fighterRequest.data?.id === fighterId ? fighterRequest.data : null;
  const { data: board } = useApi<FighterBoard>(fighterId && kind === "fighter" ? `/api/fighters/${fighterId}/stats?scope=${encodeURIComponent(scope)}` : null);
  const eventRequest = useApi<EventDetail>(eventId && kind === "event" ? withRanking(`/api/events/${eventId}`, settings.rankingSource) : null);
  const event = eventRequest.data?.id === eventId ? eventRequest.data : null;
  const request = kind === "fighter" ? fighterRequest : kind === "event" ? eventRequest : fightRequest;

  const label = subject?.label || (fight ? `${fight.f1.name} vs ${fight.f2.name}` : fighter?.name ?? event?.name ?? "");
  const pickedSubject = subject ? { ...subject, label } : null;
  const toggles: Toggle[] = useMemo(() => togglesFor(kind, board, fight).map((toggle) => ({ ...toggle, on: choices[toggle.id] ?? toggle.on })), [kind, board, fight, choices]);
  const groups = useMemo(() => [...new Set(toggles.map((toggle) => toggle.group))], [toggles]);
  const resultUnavailable = kind === "result" && fight && fight.status !== "past";
  const wrongSubject = subject && ((kind === "fighter") !== (subject.kind === "fighter") || (kind === "event") !== (subject.kind === "event"));

  // Build, fetch the pictures, then draw — the latest request wins.
  useEffect(() => {
    let cancelled = false;
    setDrawing(true);
    setGraphic(null);
    const run = async () => {
      let next: Graphic | null = null;
      if ((kind === "matchup" || kind === "result") && fight && !resultUnavailable) {
        const sides = [photoUrl(fight.f1, photoMode), photoUrl(fight.f2, photoMode)];
        const images = await Promise.all(sides.map((side) => loadImage(side.url)));
        // Both corners or neither: one picture beside an empty corner reads as an error.
        const kinds = sides.map((side, index) => images[index] ? side.kind : null);
        const photos = (images.every(Boolean) ? images.map((image, index) => ({ image: image!, kind: kinds[index]! })) : [null, null]) as [Photo, Photo];
        next = kind === "matchup" ? buildMatchup(fight, fightEvent ?? null, toggles, photos) : buildResult(fight, toggles, photos);
      } else if (kind === "fighter" && fighter) {
        const side = photoUrl(fighter, photoMode);
        const image = await loadImage(side.url);
        next = buildFighter(fighter, board ?? null, toggles, image ? { image, kind: side.kind } : null);
      } else if (kind === "event" && event) {
        next = buildEvent(event, toggles);
      }
      if (cancelled) return;
      if (next && canvas.current) renderGraphic(canvas.current, next, format, theme);
      setGraphic(next);
    };
    void run().catch(() => {
      if (!cancelled) setStatus({ tone: "error", text: "Couldn’t draw this graphic. Try fewer selections or another picture style." });
    }).finally(() => { if (!cancelled) setDrawing(false); });
    return () => { cancelled = true; };
  }, [kind, fight, fightEvent, fighter, board, event, toggles, photoMode, format, theme, resultUnavailable]);

  const fileName = `ufcsh-${(label || kind).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}-${format}.png`;
  const blob = () => graphicBlob(canvas.current);
  const copy = async () => {
    try {
      // Safari needs the promise itself handed over inside the click.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      setStatus({ tone: "ok", text: "Copied — paste it into a post." });
    } catch {
      setStatus({ tone: "error", text: "This browser wouldn’t copy the image. Download it instead." });
    }
  };
  const download = async () => {
    try {
    const url = URL.createObjectURL(await blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus({ tone: "ok", text: "Downloaded." });
    } catch {
      setStatus({ tone: "error", text: "Couldn’t download this image. Try again with pictures set to None." });
    }
  };
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    try { setCanShare(Boolean(navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] }))); } catch { setCanShare(false); }
  }, []);
  const share = async () => {
    try {
      const file = new File([await blob()], fileName, { type: "image/png" });
      await navigator.share({ files: [file], title: label });
    } catch { /* the reader closed the share sheet */ }
  };

  const loading = !request.error && (drawing || (!graphic && !resultUnavailable && !wrongSubject && Boolean(subject)));
  // Past this many lines the type shrinks below what a feed keeps legible.
  const lines = graphic?.kind === "versus" ? graphic.sections.reduce((total, section) => total + section.rows.length + 1, 0) + (graphic.judges?.length ? 2 : 0)
    : graphic?.kind === "fighter" ? graphic.stats.length : graphic?.kind === "card" ? graphic.rows.length : 0;
  const crowded = lines > (format === "portrait" ? 14 : format === "landscape" ? 10 : 11);
  const { width, height } = SIZES[format];
  const actions = (
    <>
      {canShare ? <button type="button" disabled={!graphic} onClick={() => void share()} className={`${BUTTON_SECONDARY} h-10 flex-1 md:h-auto md:flex-none`}><Share2 className="h-3.5 w-3.5" aria-hidden="true" />Share</button> : null}
      {canCopy ? <button type="button" disabled={!graphic} onClick={() => void copy()} className={`${BUTTON_SECONDARY} h-10 flex-1 md:h-auto md:flex-none`}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Copy<span className="hidden min-[400px]:inline">&nbsp;image</span></button> : null}
      <button type="button" disabled={!graphic} onClick={() => void download()} className={`${BUTTON_PRIMARY} h-10 flex-1 md:h-auto md:flex-none`}><Download className="h-3.5 w-3.5" aria-hidden="true" />Download</button>
    </>
  );
  const statusLine = status ? <span role="status" className={`text-xs ${status.tone === "ok" ? "text-emerald-700" : "text-rose-600"}`}>{status.text}</span> : null;
  const disclaimer = "Fighter photos belong to their owners; include them only where you are entitled to share them. Each image links back to its page on UFC.sh.";
  return (
    <dialog ref={dialog} aria-labelledby="graphics-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="search-dialog fixed inset-0 m-auto h-dvh max-h-none w-screen max-w-none overflow-hidden rounded-none border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl sm:h-[min(calc(100dvh-2rem),56rem)] sm:w-[min(calc(100vw-2rem),72rem)] sm:rounded-2xl sm:border">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-5 sm:py-3">
          <div className="min-w-0">
            <h2 id="graphics-title" className={`${DIALOG_TITLE} flex items-center gap-2`}><ImageIcon className="h-4 w-4 text-zinc-400" aria-hidden="true" />Generate graphic</h2>
            <p className="mt-0.5 hidden truncate text-xs text-zinc-500 sm:block">Choose what it shows, then copy or download. Every image carries its sources and the UFC.sh mark.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close graphics builder" className={`-mr-2 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
        </div>

        {/* Phones: the preview stays pinned over the scrolling controls, so a
            change shows as it is made; the actions sit in a footer. Wider
            screens: controls on the left, preview and actions on the right. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:overflow-hidden">
          <div className={`${typing ? "" : "sticky top-0"} z-10 flex flex-col gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-3 sm:px-5 md:static md:col-start-2 md:row-start-1 md:min-h-0 md:gap-3 md:overflow-hidden md:border-b-0 md:py-4`}>
            {/* A size container, so the frame can fit the space in both
                directions whatever the shape. On a phone it is no taller
                than the shape needs at full width. */}
            <div className="grid h-[min(36dvh,var(--fit))] place-items-center md:h-auto md:min-h-[16rem] md:flex-1"
              style={{ containerType: "size", "--fit": `calc((100vw - 2rem) * ${height / width})` } as CSSProperties}>
              <div className="relative" style={{ aspectRatio: `${width} / ${height}`, width: `min(100cqw, calc(100cqh * ${width / height}))` }}>
                <canvas ref={canvas} role="img" aria-label={graphic ? `Preview: ${label}` : "Graphic preview"}
                  className={`absolute inset-0 h-full w-full rounded-lg shadow-xl ring-1 ring-black/5 ${graphic ? "" : "hidden"}`} />
                {graphic ? null : (
                  <div className={`absolute inset-0 grid place-items-center rounded-lg p-4 text-center ring-1 ring-inset ring-zinc-200 ${loading ? "animate-pulse bg-zinc-100" : "bg-white"}`}>
                    {request.error ? <div role="alert" className="text-sm text-zinc-600">Couldn’t load this subject. <button type="button" onClick={request.retry} className="underline">Retry</button></div>
                      : <p role="status" className="text-sm text-zinc-400">{loading ? "Drawing…" : "Choose what the graphic is about."}</p>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="mr-auto text-[11px] text-zinc-500">
                {SIZES[format].label} · PNG
                {crowded ? <span className="block text-amber-700 md:ml-2 md:inline">A lot is selected — text will be small in a feed{format !== "portrait" ? "; Portrait fits more" : ""}.</span> : null}
              </span>
              <span className="hidden md:contents">{statusLine}{actions}</span>
            </div>
            <p className="hidden shrink-0 text-[10px] leading-4 text-zinc-400 md:block">{disclaimer}</p>
          </div>

          <div className="space-y-5 px-4 py-4 sm:px-5 md:col-start-1 md:row-start-1 md:space-y-4 md:overflow-y-auto md:border-r md:border-zinc-100"
            onFocus={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === "search") setTyping(true); }}
            onBlur={() => setTyping(false)}>
            <section className="space-y-2">
              <h3 className={EYEBROW}>1 · Graphic</h3>
              <select value={kind} onChange={(event) => { setKind(event.target.value as Kind); setChoices({}); setOptionQuery(""); setStatus(null); }} aria-label="Graphic type" className={FIELD}>
                {KINDS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.hint}</option>)}
              </select>
            </section>
            <section className="space-y-2">
              <h3 className={EYEBROW}>2 · {kind === "fighter" ? "Fighter" : kind === "event" ? "Event" : "Bout"}</h3>
              <SubjectPicker kind={kind} subject={pickedSubject} onPick={(picked) => { setSubject(picked); setChoices({}); setScope("ufc"); setStatus(null); }} />
              {resultUnavailable ? <p className="text-xs text-amber-700">This bout hasn’t happened yet — choose Matchup, or pick a finished bout.</p> : null}
              {wrongSubject ? <p className="text-xs text-zinc-500">Pick a {kind === "fighter" ? "fighter" : kind === "event" ? "event" : "bout"} for this graphic.</p> : null}
            </section>
            <section className="space-y-2">
              <h3 className={EYEBROW}>3 · Shape & look</h3>
              <Segmented label="Shape" value={format} onChange={setFormat}
                options={[{ value: "square", label: "Square" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
              <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
              {kind !== "event" ? (
                <Segmented label="Pictures" value={photoMode} onChange={setPhotoMode}
                  options={[{ value: "full", label: "Full body" }, { value: "head", label: "Face" }, { value: "none", label: "None" }]} />
              ) : null}
              {kind === "fighter" && board?.scopes.length ? (
                <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Rank against" className={FIELD}>
                  {board.scopes.map((entry) => <option key={entry.key} value={entry.key}>Rank against: {entry.label}</option>)}
                </select>
              ) : null}
            </section>
            <section className="space-y-2 md:space-y-3">
              <h3 className={EYEBROW}>4 · Include</h3>
              <input type="search" aria-label="Find graphic options" placeholder="Find a stat or market…" className={FIELD} value={optionQuery} onChange={(event) => setOptionQuery(event.target.value)} />
              <div>
                {groups.map((group) => (
                  <details key={group} open={optionQuery ? true : undefined} className="group border-t border-zinc-100 first:border-t-0 md:first:border-t">
                    <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[13px] font-semibold text-zinc-700 md:py-2 md:text-xs [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-90" aria-hidden="true" />
                      <span className="mr-auto">{group}</span>
                      <span className="text-xs font-medium text-zinc-400 md:text-[11px]">{toggles.filter((t) => t.group === group && t.on).length} selected</span>
                    </summary>
                    <div className="grid grid-cols-1 gap-x-3 pb-2 min-[420px]:grid-cols-2 md:grid-cols-1 md:gap-y-1 md:pb-0">
                      {toggles.filter((toggle) => toggle.group === group && (!optionQuery || toggle.label.toLowerCase().includes(optionQuery.toLowerCase()))).map((toggle) => (
                        <label key={toggle.id} className="flex min-h-10 min-w-0 items-center gap-2.5 text-[13px] text-zinc-600 md:min-h-0 md:gap-2 md:py-0.5 md:text-xs">
                          <input type="checkbox" checked={toggle.on} onChange={(event) => setChoices((current) => ({ ...current, [toggle.id]: event.target.checked }))}
                            className="h-4 w-4 shrink-0 accent-zinc-900 md:h-3.5 md:w-3.5" />
                          <span className="min-w-0">{toggle.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>
            <p className="text-[10px] leading-4 text-zinc-400 md:hidden">{disclaimer}</p>
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t border-zinc-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 md:hidden">
          {statusLine ? <p className="text-center">{statusLine}</p> : null}
          <div className="flex gap-2">{actions}</div>
        </div>
      </div>
    </dialog>
  );
}
