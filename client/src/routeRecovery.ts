/** A stale tab may reference chunks removed by a newer deployment. Reload once
 * per build, retaining the destination URL; persistent failures must show UI. */
export function recoverRouteImport(error: unknown, build: string, storage: Pick<Storage, "getItem" | "setItem">, reload: () => void): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(message)) return false;
  try {
    const key = "ufcsh:route-recovery";
    if (storage.getItem(key) === build) return false;
    storage.setItem(key, build);
    reload();
    return true;
  } catch {
    return false;
  }
}
