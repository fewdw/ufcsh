# Mobile app (iOS and Android)

`mobile/` is a native app built with Expo (React Native, TypeScript): one
codebase for iPhone and Android, reading the same `/api` as the site. It is
native screens, not the website in a frame.

## Daily development (all on the Ubuntu server)

- `mobile/start` runs Metro for this worktree and prints an `exps://` URL. Open
  it on the phone (Expo Go now; the development build later) over Tailscale:
  edits hot reload. `mobile/start stop`, `mobile/start logs` as with `./start`.
  Metro listens on loopback; Tailscale Serve (never Funnel) carries it.
- The app reads the worktree's `./start` preview when it is running, else
  `https://ufc.sh` (`EXPO_PUBLIC_API_URL`, `src/api.ts`).
- Checks: `npm run typecheck` and `npm run lint` in `mobile/`.
- Expo changes between SDKs; read `mobile/AGENTS.md` before touching Expo APIs.

## Native builds

Expo Go runs only the JavaScript screens. Push notifications, Live Activities,
the Dynamic Island and widgets need a development build of our own app:

- **iOS:** EAS Build in the cloud (no Mac needed), or Xcode on the MacBook
  (`npx expo run:ios`) when iterating on the SwiftUI Live Activity.
- **Android:** builds locally on Ubuntu (Android SDK) or on EAS.
- `ios/` and `android/` are generated (Continuous Native Generation) and not
  committed; native settings live in `app.json` and config plugins.
- Bundle id and package: `sh.ufc.app` (permanent once registered).

## Plan

1. Foundation: events and fight card screens (done), fight and fighter screens,
   favorites, then a TestFlight build.
2. Notifications: favorite fighter's bout starting, results, bets settled
   (APNs and FCM, sent by the server).
3. Live Activity and Dynamic Island (SwiftUI) with push-to-start, so a
   favorite's bout appears on the lock screen by itself: fighters, Polymarket
   %, round and clock, latest play-by-play. Android: a Live Update notification.
4. Widgets: next card, favorite fighter's next bout.
5. Play-by-play from a live commentary stream: speech to text, then a small
   model keeps only fight actions for the bout on now (via `news-ai.ts`'s Gemini).
