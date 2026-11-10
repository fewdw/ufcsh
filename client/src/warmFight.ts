import { useEffect, useRef, type RefObject } from "react";
import { apiCache, prefetch, type FightSide, type Matchup } from "./api";
import { preloadImage } from "./imageLevels";
import { withRanking, type RankingSource } from "./settings";

/** What a finished bout's Result tab and tab bar wait for besides the
 *  matchup: the fans' card and the picks summary. FightView holds the swap
 *  for them, so the page is drawn once instead of shifting as each lands. */
export function finishedBoutRequests(fightId: string): string[] {
  return [`/api/fights/${fightId}/scores`, `/api/fights/${fightId}/predictions`];
}

type WarmableFight = { id: string; f1: FightSide; f2: FightSide; method?: string | null; potential?: boolean };

/** A matchup about to open, from a row that already has its pictures: its
 *  data and its hero pictures load side by side, and a finished bout's fan
 *  card and picks with them. */
export function warmFight(fight: WarmableFight, ranking: RankingSource): void {
  void loadFightData(fight, ranking);
  preloadMatchupPortraits(fight.f1, fight.f2);
}

function loadFightData(fight: WarmableFight, ranking: RankingSource): Promise<unknown> {
  const requests = [withRanking(`/api/fights/${fight.id}`, ranking)];
  if (fight.method && !fight.potential) requests.push(...finishedBoutRequests(fight.id));
  return Promise.all(requests.map((request) => apiCache.load(request, 30_000)));
}

// A tap gives only ~80 ms of notice before the click, far less than a phone's
// round trip, so the bouts a reader is looking at have their data loaded
// beforehand: once a row has been on screen for a moment, one bout at a time,
// each when the page is idle. Pictures still wait for a press (they are most
// of the bytes). Crawlers and readers saving data load only what they open.
const DWELL_MS = 300;
const queue: (() => Promise<unknown>)[] = [];
let running = false;
let observer: IntersectionObserver | null = null;
const watched = new Map<Element, { warm: () => void; timer?: ReturnType<typeof setTimeout> }>();

function warmsAhead(): boolean {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return false;
  if (navigator.webdriver || /bot|crawl|spider|slurp|preview|headless/i.test(navigator.userAgent)) return false;
  return !(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
}

function idle(callback: () => void) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 2000 });
  else setTimeout(callback, 50);
}

function drain() {
  const next = queue.shift();
  if (!next) { running = false; return; }
  running = true;
  idle(() => void next().catch(() => {}).finally(drain));
}

function rowObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const row = watched.get(entry.target);
      if (!row) continue;
      clearTimeout(row.timer);
      if (entry.isIntersecting) row.timer = setTimeout(row.warm, DWELL_MS);
    }
  }, { threshold: 0.5 });
  return observer;
}

/** Loads a card row's matchup data once the row has stayed on screen. */
export function useWarmOnScreen(ref: RefObject<Element | null>, fight: WarmableFight | null, ranking: RankingSource): void {
  const latest = useRef({ fight, ranking });
  latest.current = { fight, ranking };
  const id = fight?.id;
  useEffect(() => {
    const element = ref.current;
    if (!id || !element || !warmsAhead()) return;
    const row = {
      warm: () => {
        stop();
        const { fight: current, ranking: source } = latest.current;
        if (!current) return;
        queue.push(() => loadFightData(current, source));
        if (!running) drain();
      },
    } as { warm: () => void; timer?: ReturnType<typeof setTimeout> };
    const stop = () => {
      clearTimeout(row.timer);
      if (watched.get(element) !== row) return;
      watched.delete(element);
      observer?.unobserve(element);
    };
    watched.set(element, row);
    rowObserver().observe(element);
    return stop;
  }, [ref, id]);
}

/** A matchup link without its pictures: they start the moment its data does. */
export function warmFightPictures(request: string): void {
  void apiCache.load(request, 30_000).then(() => {
    const matchup = apiCache.read(request).data as Matchup | null;
    if (matchup?.f1 && matchup.f2) preloadMatchupPortraits(matchup.f1, matchup.f2);
    if (matchup && !matchup.potential && (matchup.status === "past" || matchup.in_progress)) finishedBoutRequests(matchup.id).forEach((request) => prefetch(request));
  });
}

type PictureSide = { photo_url: string | null; photo_full_url?: string | null };

/** The matchup hero's two pictures, started when a bout is pointed at or
 *  pressed so they load with its data. Heights follow FRAME.hero in
 *  FighterPortrait (h-40, lg:h-52) and the 80 px "lg" avatar a corner without
 *  a cut-out shows. */
export function preloadMatchupPortraits(f1: PictureSide, f2: PictureSide): void {
  const hero = window.matchMedia("(min-width: 64rem)").matches ? 208 : 160;
  for (const side of [f1, f2]) {
    if (side.photo_full_url) preloadImage(side.photo_full_url, hero);
    else if (side.photo_url) preloadImage(side.photo_url, 80);
  }
}
