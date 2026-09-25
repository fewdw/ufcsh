/** The data a page asks for first, keyed exactly as the page itself asks for
 *  it, so a request started early (a hover, a press) is the one the page
 *  reads when it opens. Pages with filters in the address are warmed only in
 *  their default view. */
export function pageRequests(pathname: string, search: string, ranking: "media" | "meta"): string[] {
  const ranked = (path: string) => `${path}?ranking=${ranking}`;
  const params = new URLSearchParams(search);
  params.delete("tab");
  const plain = params.size === 0;
  let match: RegExpExecArray | null;
  if ((match = /^\/fighters\/([a-f0-9]{16})\/?$/.exec(pathname))) {
    return [ranked(`/api/fighters/${match[1]}`), `/api/fighters/${match[1]}/stats?scope=ufc&minBouts=0`];
  }
  if ((match = /^\/(fights|events)\/([a-f0-9]{16})\/?$/.exec(pathname))) return [ranked(`/api/${match[1]}/${match[2]}`)];
  if (pathname === "/rankings") return [ranked("/api/rankings")];
  if (pathname === "/officials" || pathname === "/venues") return ["/api" + pathname];
  if ((match = /^\/(judges|referees|venues)\/([a-z0-9-]{1,80})\/?$/.exec(pathname))) return plain ? [`/api/${match[1]}/${match[2]}`] : [];
  if ((match = /^\/profiles\/([^/]+)\/?$/.exec(pathname)) && match[1] !== "me" && plain) {
    return [`/api/profiles/${match[1]}?filter=decisions&q=&offset=0`];
  }
  return [];
}
