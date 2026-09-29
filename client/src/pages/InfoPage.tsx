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
    description: "UFC data for hardcore fans. About, shortcuts, community rules, privacy, support and the latest changes.",
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
          </header>

          <Section id="about">
            <p>Hey! I’m a software developer building the #1 UFC data platform for hardcore fans—all the best features in one place.</p>
            <p>I work on it weekly. Ideas, bugs or wrong stats? Please report them from your <Link to="/profiles/me">profile</Link> or email me: frederic [dot] alefebvre [at] gmail [dot] com.</p>
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
            <p>Logged out: page views are counted; preferences stay in your browser.</p>
            <p>Logged in: Clerk handles sign-in; your account activity is saved, and your profile is public.</p>
          </Section>

          <Section id="terms">
            <p>UFC.sh is independent and unaffiliated with the UFC. Use it for information, not betting advice; accuracy isn’t guaranteed.</p>
          </Section>

          <Section id="support">
            <p>This passion project comes out of my pocket. Every dollar helps cover hosting and make the site better.</p>
            <p>Interac (Canada) or PayPal: frederic [dot] alefebvre [at] gmail [dot] com.</p>
          </Section>

          <Section id="changelog">
            <p><time dateTime="2026-09-29">September 29, 2026</time></p>
            <ul>
              <li>Leaderboards are now a tab on your profile.</li>
              <li>Report an issue lives only on your profile.</li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
