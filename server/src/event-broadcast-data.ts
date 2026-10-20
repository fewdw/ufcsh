/** Reviewed event-specific reports. No crew is inferred from another event.
 * Add a dated source here when a report cannot be imported through its headings. */
export type BroadcastRole = "play_by_play" | "color_commentary" | "announcer" | "reporter" | "desk_host" | "desk_analysts" | "weigh_in_host" | "weigh_in_analysts";
export type Broadcast = { language: string; feed: string; source_url: string; reported_at: string; roles: Partial<Record<BroadcastRole, string[]>> };
export const EVENT_BROADCASTS: Record<string, Broadcast> = {
  "UFC 332": {
    language: "English", feed: "US / English-language broadcast", reported_at: "2026-09-29",
    source_url: "https://www.aol.com/articles/ufc-332-broadcast-team-set-134021000.html",
    roles: { play_by_play: ["Jon Anik"], color_commentary: ["Joe Rogan", "Daniel Cormier"], announcer: ["Bruce Buffer"], reporter: ["Megan Olivi"], desk_host: ["Kate Scott"], desk_analysts: ["Chris Weidman", "Michael Chiesa"], weigh_in_host: ["Dan Hellie"], weigh_in_analysts: ["Daniel Cormier", "Chris Weidman", "Michael Chiesa"] },
  },
  "UFC 333": {
    language: "English", feed: "US / English-language broadcast", reported_at: "2026-10-20",
    source_url: "https://uk.sports.yahoo.com/news/ufc-333-broadcast-team-set-125023055.html",
    roles: { play_by_play: ["Jon Anik"], color_commentary: ["Daniel Cormier", "Paul Felder"], announcer: ["Bruce Buffer"], reporter: ["John Gooden"], desk_host: ["Brendan Fitzgerald"], desk_analysts: ["Robert Whittaker", "Din Thomas"] },
  },
};
