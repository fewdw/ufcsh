/** Whether anyone may be signed in here, read without Clerk (auth.tsx loads
 *  Clerk only then). Clerk's `__client_uat` cookie, sometimes with a suffix
 *  (`__client_uat_AbC123`), holds when a session was last active, and 0 once
 *  signed out. */
export function sessionCookieSet(cookie: string): boolean {
  return /(?:^|;\s*)__client_uat(?:_[^=]*)?=(?!0(?:;|$))[^;]/.test(cookie);
}

/** Pages that are about the account itself load Clerk whoever opens them. */
export function accountPage(pathname: string): boolean {
  return /^\/(sign-in|sign-up|profiles\/me|admin)(\/|$)/.test(pathname);
}
