import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PANEL } from "../components/chartTokens";
import { useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import { Keys, SHORTCUTS } from "../shortcuts";
import { EYEBROW } from "../ui";

/**
 * About the site, how its numbers are made, and the rules and notices that go
 * with it. Facts the code already fixes (sources, cadence, definitions) are
 * written out; what only the owner can write is marked as a draft so it is
 * never mistaken for a finished notice.
 */

const SECTIONS = [
  { id: "about", title: "About" },
  { id: "sources", title: "Data sources & updates" },
  { id: "methods", title: "How the numbers work" },
  { id: "glossary", title: "Stats glossary" },
  { id: "scoring", title: "Scoring guide" },
  { id: "shortcuts", title: "Keyboard shortcuts" },
  { id: "corrections", title: "Corrections & feedback" },
  { id: "community", title: "Community rules" },
  { id: "privacy", title: "Privacy" },
  { id: "terms", title: "Terms" },
  { id: "disclosures", title: "Disclosures & credits" },
  { id: "changelog", title: "Changelog" },
] as const;

function Section({ id, children }: { id: (typeof SECTIONS)[number]["id"]; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${PANEL} scroll-mt-3 px-4 py-4 sm:px-6 sm:py-5`}>
      <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
      <div className="mt-2 space-y-2.5 text-[13px] leading-6 text-zinc-700 [&_a]:font-medium [&_a]:text-zinc-900 [&_a]:underline [&_a]:decoration-zinc-300 [&_a]:underline-offset-2 [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-zinc-900">
        {children}
      </div>
    </section>
  );
}

/** A passage the owner still has to write. Visible on purpose. */
function Draft({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
      <span className="mr-1.5 rounded bg-amber-200 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em]">Draft</span>
      {children}
    </div>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 py-1.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="font-semibold text-zinc-900">{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function InfoPage() {
  const scroll = useRouteScrollRestoration<HTMLDivElement>("info");
  useSeo({
    title: "About, Sources & Methods",
    description: "About UFC.sh: an independent, fan-made UFC research tool. Data sources, how each number is calculated, community rules, privacy and changelog.",
    path: "/info",
  });
  return (
    <div ref={scroll} className="h-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-5xl gap-3 p-2 pb-12 sm:p-3 lg:grid-cols-[13rem_minmax(0,1fr)] lg:p-4">
        <nav aria-label="On this page" className="lg:sticky lg:top-4 lg:self-start">
          <div className={`${PANEL} px-3 py-3`}>
            <p className={`${EYEBROW} px-2 pb-1.5`}>UFC.sh</p>
            <ul className="flex flex-wrap gap-1 lg:flex-col lg:gap-0">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="block rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">{section.title}</a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          <header className={`${PANEL} px-4 py-5 sm:px-6`}>
            <p className={EYEBROW}>Information</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">Built by a fan, for fans</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              UFC.sh is an independent research tool for people who prepare for fight night: fans, writers, creators and broadcasters.
              Everyday browsing stays simple; the deeper you look, the more you find — and every number can be traced to the bouts behind it.
            </p>
          </header>

          <Section id="about">
            <p>UFC.sh is <strong>independent and fan-made</strong>. It is not affiliated with, endorsed by or sponsored by the UFC, Zuffa or TKO Group. “UFC” and fighter names are used only to describe the sport the site covers.</p>
            <p>The aim: turn a week of card preparation into a couple of hours, without asking anyone to take a number on faith.</p>
            <Draft>Write a few lines about yourself: who you are, why you built this, and how people can reach you (a public email or social handle).</Draft>
          </Section>

          <Section id="sources">
            <p>Everything refreshes automatically in the background; pages say how old their copy is instead of pretending to be live.</p>
            <dl className="divide-y divide-zinc-100">
              <Term name="Results & fight stats">UFCStats — the events list hourly, live cards every few minutes on fight day, and each bout’s official round-by-round totals.</Term>
              <Term name="Card times, segments, venues">The UFC’s own event pages and live-card feed: segment start times, which bouts are on the main card, booked rounds, venue, broadcasters and assigned referees.</Term>
              <Term name="Rankings & photos">ufc.com rankings every six hours; fighter headshots and full-body pictures from athlete pages.</Term>
              <Term name="Complete careers">Sherdog, matched to each fighter only after identity checks pass; unverified careers are left out rather than guessed.</Term>
              <Term name="Odds">BestFightOdds moneylines and props, frozen as closing lines once a card is over.</Term>
              <Term name="Judges’ round cards">Verdict MMA and MMA Decisions, attached only when the judge and final score match the official card. Verdict MMA also supplies large community (fan) scorecards.</Term>
              <Term name="Event articles">Wikipedia, for weigh-in misses, the venue name on the night, attendance, gate and the background reporting shown on a matchup’s Context tab.</Term>
            </dl>
          </Section>

          <Section id="methods">
            <ul>
              <li><strong>As of that night.</strong> Every “entering” figure on a matchup — record, streak, rates — is rebuilt from earlier bouts, never today’s totals projected backwards.</li>
              <li><strong>Missing is unknown, not zero.</strong> A bout only counts toward a rate when the source recorded what the rate needs; sample sizes are shown beside the rate.</li>
              <li><strong>Minimum samples.</strong> Rate leaderboards and profile rankings require a floor of bouts or attempts, so one fight cannot top a percentage.</li>
              <li><strong>Win rate</strong> is wins over bouts with an official result: draws stay in the denominator; no contests are left out.</li>
              <li><strong>Odds</strong> are closing lines; implied probabilities include the bookmaker’s margin unless a figure says “vig-free”.</li>
              <li><strong>Profile rankings</strong> use competition ranking (1, 2, 2, 4). “Weight class” counts only bouts fought at that weight, ranked against everyone else’s bouts there.</li>
              <li><strong>Officials.</strong> Judge agreement is measured by winner per scorecard, and per round where round cards exist. Agreement is not proof a judge was right; a pattern in a referee’s bouts is not proof the referee caused it.</li>
            </ul>
          </Section>

          <Section id="glossary">
            <dl className="divide-y divide-zinc-100">
              <Term name="Significant strikes">Strikes UFCStats counts as significant: all strikes at distance, and power strikes in the clinch and on the ground.</Term>
              <Term name="Accuracy / defence">Landed over attempted (or attempts stopped over attempts faced), only from bouts where both numbers were recorded.</Term>
              <Term name="Per 15 minutes">A total scaled to fifteen minutes of fight time — three full rounds.</Term>
              <Term name="Control share">Time in control over elapsed fight time, from bouts that recorded control.</Term>
              <Term name="Finish rate">Wins by KO/TKO or submission over all wins.</Term>
              <Term name="Durability">Consecutive bouts without being finished.</Term>
              <Term name="Wins above market">Wins minus the wins a vig-free closing line expected.</Term>
              <Term name="Dissent (judge)">A card picking a different winner from both colleagues on a full three-judge panel.</Term>
              <Term name="10–8 rate">Rounds scored with a gap of two or more, over rounds scored. A point deduction can also produce one on paper.</Term>
            </dl>
          </Section>

          <Section id="scoring">
            <p>Every completed bout has a <strong>Score</strong> tab. Score each round 10–9, 10–8 or 10–10 and deduct points where the referee did; your card counts once, and changing it replaces your earlier vote.</p>
            <p>Score what happened in the round, not the fight: effective striking and grappling first, then effective aggression, then cage control. A 10–8 is for a round that was dominant, not merely clear.</p>
            <p>The community card is the average of every fan card; the judges’ cards sit beside it on the Result tab, and your profile shows how often you agreed with them.</p>
          </Section>

          <Section id="shortcuts">
            <ul className="!ml-0 space-y-2">
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.action} className="!ml-0 flex list-none items-start justify-between gap-4">
                  <span>{shortcut.action}</span><Keys keys={shortcut.keys} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">Shortcuts pause while you type, inside tabs and lists, and while a dialog is open. Press <Keys keys={["?"]} /> on any page to see what the arrows do there.</p>
          </Section>

          <Section id="corrections">
            <p>Spotted a wrong result, a missing bout or a mismatched fighter? Signed-in readers can use <strong>Report</strong> on their <Link to="/profiles/me">profile</Link>; every report reaches an administrator with the page it came from.</p>
            <p>Corrections to source data are applied at the source’s next refresh when the source itself is fixed, or as a documented repair when it is not.</p>
            <Draft>Add a contact route for people without an account (email address or form), and how quickly you aim to respond.</Draft>
          </Section>

          <Section id="community">
            <ul>
              <li>Argue about fights, not people. Harassment, threats, hate, doxxing and self-harm incitement are removed.</li>
              <li>No spam or copy-paste floods; links are limited, and new accounts cannot post them.</li>
              <li>Use <strong>Report</strong> on a comment when it breaks these rules. A comment reported by three established accounts is hidden until a moderator reviews it.</li>
              <li><strong>Block</strong> hides someone’s comments for you and stops them replying to you.</li>
            </ul>
          </Section>

          <Section id="privacy">
            <p>Browsing needs no account. Page views are counted by route only — the server discards usernames and fight IDs from those counts. Preferences such as theme and odds format stay in your browser.</p>
            <p>Signing in (through Clerk) lets you save scorecards, predictions and comments; those are stored with your account and shown on your public profile, except comments, which stay hidden there until you choose to show them.</p>
            <Draft>Have a proper privacy notice written for your jurisdiction and users: what is collected, the legal basis, retention periods, processors (Clerk, hosting, Cloudflare), how to request deletion, and a contact. Don’t publish this page as final until it is.</Draft>
          </Section>

          <Section id="terms">
            <Draft>Add terms of use: acceptable use of the site and its data, that statistics and odds are informational only and not betting advice, liability limits, and your rights to moderate content. A lawyer should review them before launch.</Draft>
          </Section>

          <Section id="disclosures">
            <p>Odds are shown for research. UFC.sh takes no bets and currently has no sportsbook or affiliate relationships.</p>
            <p>Fighter photographs are the property of their owners and are shown for identification. Shared graphics made on UFC.sh carry the site’s watermark and a link back to their source page.</p>
            <Draft>If you add sponsors or affiliate links, disclose them here and beside the link itself. Confirm whether fighter images may be redistributed in shared graphics, or switch graphics to name-only.</Draft>
          </Section>

          <Section id="changelog">
            <p><strong>Version 2.0</strong></p>
            <ul>
              <li>Fighter profiles: every ranked statistic, read across the UFC or within one weight class, grouped or best-first.</li>
              <li>Matchups: a Context tab with form, milestones, history, key differences, sourced developments, venue, broadcast and officials.</li>
              <li>Graphics builder: shareable fighter, matchup, event and result graphics with copy and download.</li>
              <li>Judge and referee profiles, reached from any scorecard or referee name.</li>
              <li>Venue pages with every card held there, local times and attendance.</li>
              <li>Keyboard shortcuts, this page, and richer previews when pages are shared.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
