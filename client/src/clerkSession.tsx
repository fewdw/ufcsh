import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/react";
import { useEffect, type ReactNode } from "react";
import type { ClerkAnswer, SessionProps } from "./auth";

/** Set when Clerk's Frontend API is reached through this site's own /__clerk. */
const PROXY_URL = (import.meta.env.VITE_CLERK_PROXY_URL as string | undefined) || undefined;

/** Clerk's own windows follow the reader's theme: the app's zinc palette, so a
 *  sign-in dialog is not a white sheet over a dark page. */
const DARK = {
  colorBackground: "#18181b", colorForeground: "#f4f4f5", colorMuted: "#27272a", colorMutedForeground: "#a1a1aa",
  colorInput: "#27272a", colorInputForeground: "#f4f4f5", colorBorder: "#3f3f46", colorNeutral: "#a1a1aa",
  colorPrimary: "#f4f4f5", colorModalBackdrop: "rgba(0,0,0,0.6)",
};

/** Clerk, loaded on its own beside the app (`AuthProvider` in auth.tsx) so the
 *  page never waits for it or remounts when it arrives. Its windows open from
 *  the instance, outside this tree. */
export default function ClerkSession({ publishableKey, dark, onChange }: SessionProps): ReactNode {
  return (
    <ClerkProvider publishableKey={publishableKey} proxyUrl={PROXY_URL} signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/" appearance={{ variables: dark ? DARK : {} }}>
      <Report onChange={onChange} />
    </ClerkProvider>
  );
}

function Report({ onChange }: { onChange: (answer: ClerkAnswer) => void }): ReactNode {
  const clerk = useClerk();
  const { isLoaded, user } = useUser();
  const { getToken } = useAuth();
  useEffect(() => {
    // While a sign-in completes, Clerk briefly reports no user as it moves to
    // the next page; the last answer stands, so its form stays mounted.
    if (!isLoaded || user === undefined) return;
    onChange({ user, getToken, clerk });
  }, [onChange, isLoaded, user, getToken, clerk]);
  return null;
}
