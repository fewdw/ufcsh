import { useState } from "react";
import { Link } from "react-router-dom";
import type { NewsStory } from "../api";
import { exactTime } from "../format";
import Avatar from "./Avatar";

/** Outlets switched off, kept by name: an outlet added later starts on. */
export const OFF_KEY = "ufcsh:news-off:v1";

export function savedOff(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OFF_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
  } catch { return []; }
}

/** Summaries shown or not: on unless switched off. */
export const SUMMARIES_KEY = "ufcsh:news-summaries:v1";

export function savedSummaries(): boolean {
  try { return localStorage.getItem(SUMMARIES_KEY) !== "0"; } catch { return true; }
}

/** "12m", "5h", then the day, and the year once it isn't this one. */
function age(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  const year = new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year }).format(at);
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/** What the story says, two lines of it until it's opened. */
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={`mt-1 block max-w-3xl cursor-pointer text-left text-[13px] leading-5 text-zinc-500 transition-colors hover:text-zinc-700 ${open ? "" : "line-clamp-2"}`}
    >
      {text}
    </button>
  );
}

/** One story, the same for every story: the outlet, who and what it is about
 *  and when on the first line; the headline, linked to the outlet, below, and
 *  what it says (`summaries`). On a fighter's page (`fighterId`) their own
 *  name is left out. */
export default function NewsRow({ story, fighterId, summaries }: { story: NewsStory; fighterId?: string; summaries?: boolean }) {
  const also = story.also.map((other) => other.source).join(", ");
  return (
    <article className="border-t border-zinc-100 py-3.5 first:border-t-0 not-dark:border-zinc-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] leading-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-zinc-900">
          {story.source}
          {also ? <span className="ml-1 font-medium normal-case tracking-normal text-zinc-400" title={`Also ${also}`} aria-label={`also ${also}`}>+{story.also.length}</span> : null}
        </span>
        {story.fighters.filter((fighter) => fighter.id !== fighterId).map((fighter) => (
          <Link key={fighter.id} to={`/fighters/${fighter.id}`} className="group flex items-center gap-1.5 font-medium text-zinc-600 hover:text-zinc-950">
            <Avatar src={fighter.photo_url} name={fighter.name} size="tag" />
            <span className="decoration-zinc-400 underline-offset-2 group-hover:underline">{fighter.name}</span>
          </Link>
        ))}
        {story.event ? (
          <Link to={`/events/${story.event.id}`} className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-950">
            {story.event.name}
          </Link>
        ) : null}
        <time dateTime={new Date(story.published_at).toISOString()} title={exactTime(story.published_at) ?? undefined} className="tabular-nums text-zinc-400">
          {age(story.published_at)}
        </time>
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <a href={story.url} {...external} className="text-zinc-950 decoration-zinc-400 decoration-1 underline-offset-[5px] hover:underline">{story.title}</a>
      </h3>
      {summaries && story.summary ? <Summary text={story.summary} /> : null}
    </article>
  );
}
