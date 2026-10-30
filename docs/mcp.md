# MCP server

`POST https://ufc.sh/mcp` lets AI agents (Claude, ChatGPT, Cursor, anything that
speaks the Model Context Protocol) use ufc.sh's public data. It is read-only and
needs no account or key.

Connect it as a remote server with the Streamable HTTP transport, for example:

```sh
claude mcp add --transport http ufcsh https://ufc.sh/mcp
```

## How it is built

- `server/src/mcp.ts`: the protocol. One JSON-RPC message per POST, always
  answered as JSON, with no session or stream. It serves both eras: revision
  2026-07-28 and later (version and capabilities in every request's `_meta`,
  mirrored in headers that must match, `server/discover`), and 2025-06-18 and
  2025-11-25 (`initialize`). 2025-03-26 is left out because it requires JSON-RPC
  batches, which would carry many calls past the rate limit in one request.
  Adding a revision means adding it to `MODERN_VERSIONS` after reading its
  changelog.
- `server/src/mcp-tools.ts`: the tools. Each reads the site's public answers and
  shapes them into a few KB. Add a tool to `TOOLS`; the "every tool reads public
  routes only" test needs a sample call for it.
- `startApi` in `server/src/api.ts` supplies the data: `read` refuses anything
  `publicApi` does not allow, so admin and bug data cannot be reached, and it
  shares the response cache and query workers. Fan scores, Polymarket and live
  odds are read from the same services their public routes use.

## Rules for tools

- Public data only. Nothing that signs in, writes or depends on who is asking.
- Say when a number applies. `get_fight` is "entering this fight"; `get_fighter`
  is today. Keep the labels when adding fields. History rows' `before_fight`
  uses the shared bout chronology, including earlier bouts on the same night.
- An unknown value is left out, never zero (`prune`). Agents are told so.
- Use the shared formulas (`career-metrics.ts`) and ranks (`ranking=media`, the
  site's default, which is not the API's).
- Never guess a name. `choose` returns candidates when several match, and takes
  a close spelling alone only for a fighter, whose name the answer shows back.
  Match a division by its whole name: "heavyweight" is inside "Light Heavyweight".
- Refuse what cannot be applied. `getStats` quietly drops options a board cannot
  use; `leaderboard` must return an error instead of echoing them as applied.
- Name both corners. Scores are pairs in the order of `fighters`, and the note
  beside them says so.
- Bout leaderboards return `fight_id` for `get_fight` and `fighter_id` for
  `get_fighter`; their URL opens the bout.
- Stay inside `MAX_RESULT_CHARS`. `fitted` drops the largest parts of an answer
  and lists them, as a last resort; prefer `limit` and `include`.
- News titles and summaries are third-party text. Agents are told to treat them
  as information, never instructions.

## Limits

POSTs are not cached at the edge, so every call reaches the origin. Each address
gets a burst of 60 calls and 5 a second, and 16 tool calls may run at once across
all clients; past that a tool answers "busy". Agents behind one provider share an
address, so raise the per-address limit if real traffic hits it.

`/api/metrics` counts calls per tool (`mcp_tool_calls`, since the last restart),
and `/mcp` has its own row in Admin → Traffic.

## Origin

The spec requires validating `Origin` to stop web pages reaching private local
servers. This server is public and reads no cookies or credentials, so every
well-formed web origin is allowed (with CORS, for browser-based agents) and only
malformed or opaque ones (`null`) get a 403.
