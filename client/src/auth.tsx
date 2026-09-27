/* oxlint-disable react/only-export-components -- the provider, the account hook
   and the enabled flag are one session, kept in one place. */
import { ClerkProvider, useClerk, useUser } from "@clerk/react";
import { useCallback, type ReactNode } from "react";
import { useSettings } from "./settings";

const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
/** Set when Clerk's Frontend API is reached through this site's own /__clerk. */
const PROXY_URL = (import.meta.env.VITE_CLERK_PROXY_URL as string | undefined) || undefined;
/** Without a key the application runs exactly as before: everything public,
 *  no account control, no Clerk request. */
export const accountsEnabled = Boolean(KEY);
/** Signing in returns to the page being read; signing out goes home, since the
 *  page being read may be the account's own profile. */
const here = () => window.location.pathname + window.location.search;

/** Clerk's own windows follow the reader's theme: the app's zinc palette, so a
 *  sign-in dialog is not a white sheet over a dark page. */
const DARK = {
  colorBackground: "#18181b", colorForeground: "#f4f4f5", colorMuted: "#27272a", colorMutedForeground: "#a1a1aa",
  colorInput: "#27272a", colorInputForeground: "#f4f4f5", colorBorder: "#3f3f46", colorNeutral: "#a1a1aa",
  colorPrimary: "#f4f4f5", colorModalBackdrop: "rgba(0,0,0,0.6)",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  if (!KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={KEY} proxyUrl={PROXY_URL} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/" appearance={{ variables: settings.theme === "dark" ? DARK : {} }}>
      {children}
    </ClerkProvider>
  );
}

/** The one account: read anywhere, signed into from the current page. */
export function useAccount() {
  const clerk = useClerk();
  const { isLoaded, user } = useUser();
  const signIn = useCallback(() => { void clerk.openSignIn({ fallbackRedirectUrl: here(), signUpFallbackRedirectUrl: here() }); }, [clerk]);
  const signOut = useCallback(() => { void clerk.signOut({ redirectUrl: "/" }); }, [clerk]);
  const manage = useCallback(() => { void clerk.openUserProfile(); }, [clerk]);
  return { isLoaded, user, signIn, signOut, manage };
}
