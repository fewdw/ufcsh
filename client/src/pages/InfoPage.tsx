import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PANEL } from "../components/chartTokens";
import { useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import { Keys, SHORTCUTS } from "../shortcuts";
import { EYEBROW } from "../ui";

const SECTIONS = [
  { id: "about", title: "About" },
  { id: "shortcuts", title: "Keyboard shortcuts" },
  { id: "community", title: "Community rules" },
  { id: "privacy", title: "Privacy" },
  { id: "terms", title: "Terms" },
  { id: "support", title: "Support me" },
  { id: "changelog", title: "Changelog" },
] as const;

// Put together on the page, so the address never sits whole in the source.
const EMAIL = ["frederic.alefebvre", "gmail.com"].join("@");
const Email = () => <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

function Section({ id, children }: { id: (typeof SECTIONS)[number]["id"]; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)!.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${PANEL} scroll-mt-3 px-4 py-4 sm:px-6 sm:py-5`}>
      <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
      <div className="mt-2 space-y-2.5 text-[13px] leading-6 text-zinc-700 [&_a]:font-medium [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_a]:decoration-current [&_a]:underline-offset-2 [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-zinc-900">
        {children}
      </div>
    </section>
  );
}

export default function InfoPage() {
  const scroll = useRouteScrollRestoration<HTMLDivElement>("info");
  useSeo({
    title: "About",
    description: "UFC data for hardcore fans. About, shortcuts, community rules, privacy, terms, support and the latest changes.",
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
          <h1 className="sr-only">Information</h1>

          <Section id="about">
            <p>Hey! I’m a software developer building the #1 UFC data platform for hardcore fans—all the best features in one place.</p>
            <p>I work on it weekly. Ideas, bugs or wrong stats? Please report them from your <Link to="/profiles/me">profile</Link> or email me: <Email />.</p>
            <p>Mistakes happen, but I’m working hard to keep it accurate. Thanks for helping!</p>
          </Section>

          <Section id="shortcuts">
            <ul className="!ml-0 space-y-2">
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.action} className="!ml-0 flex list-none items-start justify-between gap-4">
                  <span>{shortcut.action}</span><Keys keys={shortcut.keys} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">Press <Keys keys={["?"]} /> for help. Shortcuts pause while you type.</p>
          </Section>

          <Section id="community">
            <p>Keep it civil. Argue, swear, just don’t take it too far—no hate, threats or harassment. I don’t want to mute or ban anyone.</p>
          </Section>

          <Section id="privacy">
            <p>Signed out: visits are counted anonymously with a random ID kept in your browser, plus the linking site, device type and country. The ID is scrambled before it’s saved and deleted after 35 days; only daily totals stay. IP addresses aren’t stored.</p>
            <p>Signed in: you sign in with Google through <a href="https://clerk.com/legal/privacy" target="_blank" rel="noreferrer">Clerk</a>, which keeps your name, email and picture. I keep your username, picture and what you do here: scorecards, predictions, bets, comments and reports. Your profile, scorecards and comments are public.</p>
            <p>Cookies and storage: Clerk’s cookies keep you signed in, and Cloudflare, which carries the site’s traffic, may set one to stop bots. Settings and recently loaded pages are kept in your browser. No ads, no tracking cookies, no outside analytics.</p>
            <p>Deleting your data: on your <Link to="/profiles/me">profile</Link>, Manage account → Delete account. Your scorecards, predictions, bets and comments are erased within minutes. Or email me and I’ll do it.</p>
            <p>I never sell or share your data.</p>
          </Section>

          <Section id="terms">
            <p>UFC.sh is independent and unaffiliated with the UFC. Use it for information, not betting advice; accuracy isn’t guaranteed.</p>
            <p>The site is free. Bets here are for fun: no real money is staked or paid out.</p>
            <p>You must be 13 or older to make an account. Follow the community rules; I may remove posts or accounts that break them.</p>
            <p>Donations are gifts and get nothing in return. Sent one by mistake? Email me and I’ll refund it.</p>
          </Section>

          <Section id="support">
            <p>This passion project comes out of my pocket. Every dollar helps cover hosting and make the site better.</p>
            <p>Interac (Canada) or PayPal: <Email />.</p>
          </Section>

          <Section id="changelog">
            <p><time dateTime="2026-10-18">October 18, 2026</time></p>
            <ul>
              <li>Live rounds open with Verdict MMA, and its fans’ scores join the Score tab.</li>
              <li>Fighter profiles show how each finish came, with a switch for cancelled or moved bouts.</li>
              <li>Cleaner scorecards and a simpler image when sharing the homepage.</li>
              <li>Faster event and fight pages, with slow requests listed in Admin.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
