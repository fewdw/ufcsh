import { apiCache, prefetch, type FightSide, type Matchup } from "./api";
import { preloadImage } from "./imageLevels";
import { withRanking, type RankingSource } from "./settings";

/** A matchup about to open, from a row that already has its pictures: its
 *  data and its hero pictures load side by side. */
export function warmFight(fight: { id: string; f1: FightSide; f2: FightSide }, ranking: RankingSource): void {
  prefetch(withRanking(`/api/fights/${fight.id}`, ranking));
  preloadMatchupPortraits(fight.f1, fight.f2);
}

/** A matchup link without its pictures: they start the moment its data does. */
export function warmFightPictures(request: string): void {
  void apiCache.load(request, 30_000).then(() => {
    const matchup = apiCache.read(request).data as Matchup | null;
    if (matchup?.f1 && matchup.f2) preloadMatchupPortraits(matchup.f1, matchup.f2);
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
