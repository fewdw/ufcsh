import { accountsEnabled } from "../auth";
import { PAGE, PAGE_BODY } from "../research";
import { useMyProfile } from "../profile";
import { useSeo } from "../seo";
import Leaderboards from "../components/Leaderboards";
import { PANEL } from "../components/chartTokens";

/** The reader's own row is marked once their profile is known. */
function Boards() {
  const { identity } = useMyProfile();
  return <Leaderboards handle={identity?.publicId ?? ""} />;
}

/** The fans' leaderboards: predictions, method calls and bets. */
export default function LeaderboardsPage() {
  useSeo({ title: "Fan Leaderboards", description: "The best UFC predictors and bettors on UFC.sh: prediction points, winner and method accuracy, and betting profit.", path: "/leaderboards" });
  return (
    <div className={PAGE}>
      <div className={`${PAGE_BODY} xl:max-w-6xl`}>
        <header className={`${PANEL} px-4 py-4 sm:px-5`}>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">Leaderboards</h1>
          <p className="mt-0.5 text-[12px] text-zinc-500">The fans who call fights best: points, winners, methods and betting profit.</p>
        </header>
        {accountsEnabled ? <Boards /> : <Leaderboards handle="" />}
      </div>
    </div>
  );
}
