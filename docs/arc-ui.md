# Arc UI styling

The client uses [Arc UI](https://uiarc.dev/docs/ai) with its public registry
configured in `client/components.json`. Installed source lives in
`client/src/components/arc`: foundation tokens, buttons, switches, tabs, and
their motion tokens. `client/src/index.css` imports the foundation once and
self-hosted Inter and Geist fonts from Fontsource.

`SettingsProvider` applies both `.dark` (Tailwind variants) and `data-theme`
(Arc tokens). The early HTML script also applies the saved dark palette before
the first paint. App classes name semantic roles such as `surface`, `secondary`,
`line`, and `success`; additional information, activity, and category roles live
in `index.css`, with their own dark values. Change these tokens instead of
adding shade-specific dark overrides to individual components.

The existing event/card layout, profile and matchup sections, records,
statistics, API requests, filters, routes, and numerical formatting are
preserved. Chart series and fighter corner colors retain their domain meaning.
Dense table and chart typography stays compact to preserve the data layout.
Existing link-based navigation and domain-specific charts use Arc tokens;
they keep their existing routing and interaction code. Graphics exported by
the graphics builder keep their existing rendering templates.

Arc provides buttons in report, profile, removal, and graphics actions, switches
in settings, and keyboard-accessible tabs in admin. The shared foundation owns
keyboard focus; clipped rows adjust `--focus-outline-offset` rather than
drawing another focus ring. Reduced motion follows the existing global rule
and the installed components' reduced-motion behavior.

## Review on dev

Check Events (upcoming and completed cards), Rankings, a fighter profile, a
matchup and its statistics/scoring tabs, News, Browse, profile actions, and
Admin. Check light and dark at 320, 390, 768, 1024, and 1440px. Exercise search,
settings switches, keyboard tabs, dialogs, long names, and internal table
scrolling. Visual and interaction review is handed to the user because
`dev.ufc.sh` requires their Cloudflare Access sign-in.

Automated verification: client tests, client lint, production TypeScript/Vite
build, and `git diff --check`. No server or archive files are changed.
