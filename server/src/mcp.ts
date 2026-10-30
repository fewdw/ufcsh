import type { IncomingMessage, ServerResponse } from "node:http";

/** The MCP endpoint: read-only tools for AI agents, one JSON-RPC message per
 *  POST (Streamable HTTP, always answered as plain JSON). Nothing is kept
 *  between requests, so both eras of the protocol share one handler: revisions
 *  from 2026-07-28 declare their version on every request, earlier ones open
 *  with `initialize`, which needs no session here. Tools live in mcp-tools.ts. */

export const MODERN_VERSIONS = ["2026-07-28"];
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const META = "io.modelcontextprotocol";
const MAX_BODY_BYTES = 64 * 1024;
/** The tool list changes only with a release. */
const LIST_TTL_MS = 60 * 60_000;
// Outside the range JSON-RPC and MCP reserve.
export const RATE_LIMITED = -31_000;

export type ToolResult = { text: string; isError: boolean };
export type McpServer = {
  info: { name: string; title?: string; version: string };
  instructions: string;
  tools: { name: string; title: string; description: string; inputSchema: unknown; annotations: unknown }[];
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
};
type Reply = { status: number; body?: unknown };

const isObject = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);

export const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0", ...(id === undefined || id === null ? {} : { id }), error: { code, message, ...(data === undefined ? {} : { data }) },
});
const rejected = (status: number, id: unknown, code: number, message: string, data?: unknown): Reply => ({ status, body: rpcError(id, code, message, data) });

/** `Mcp-Name` is sent as `=?base64?…?=` when a name is not plain ASCII. */
function decodeHeader(value: string): string {
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value);
  return encoded ? Buffer.from(encoded[1], "base64").toString("utf8") : value;
}

/** What a modern request must carry beyond JSON-RPC, or the reply refusing it. */
function refusal(id: unknown, method: string, params: Record<string, any> | undefined, header: (name: string) => string | undefined): Reply | null {
  const meta = params?._meta;
  const declared = meta?.[`${META}/protocolVersion`];
  const named = header("mcp-protocol-version");
  const requested = declared ?? named;
  if (!MODERN_VERSIONS.includes(requested)) {
    return rejected(400, id, -32022, "Unsupported protocol version", { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested });
  }
  if (typeof declared !== "string") return rejected(400, id, -32602, `Missing _meta["${META}/protocolVersion"]`);
  if (!isObject(meta[`${META}/clientCapabilities`])) return rejected(400, id, -32602, `Missing _meta["${META}/clientCapabilities"]`);
  const mismatch = (message: string) => rejected(400, id, -32020, `Header mismatch: ${message}`);
  if (named !== declared) return mismatch("MCP-Protocol-Version does not match the request's protocol version");
  if (header("mcp-method") !== method) return mismatch("Mcp-Method does not match the request's method");
  if (method === "tools/call") {
    const name = header("mcp-name");
    if (name === undefined || decodeHeader(name) !== params?.name) return mismatch("Mcp-Name does not match the tool being called");
  }
  return null;
}

/** One JSON-RPC message in, one reply out. No session, no state. */
export async function answerMcp(server: McpServer, message: unknown, header: (name: string) => string | undefined): Promise<Reply> {
  const id = isObject(message) ? message.id : undefined;
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return rejected(400, id, -32600, "Invalid Request");
  const { method, params } = message;
  if (params !== undefined && !isObject(params)) return rejected(400, id, -32602, "params must be an object");
  // Notifications ask for nothing; this server has nothing to do with any of them.
  if (id === undefined) return { status: 202 };
  if (typeof id !== "string" && !Number.isSafeInteger(id)) return rejected(400, null, -32600, "Invalid Request");

  if (method === "initialize") {
    const asked = params?.protocolVersion;
    return { status: 200, body: { jsonrpc: "2.0", id, result: {
      protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: server.info,
      instructions: server.instructions,
    } } };
  }

  // A modern request says so; a legacy one sends no version, or its own.
  const declared = params?._meta?.[`${META}/protocolVersion`];
  const named = header("mcp-protocol-version");
  const modern = declared !== undefined || (named !== undefined && !LEGACY_VERSIONS.includes(named));
  if (modern) {
    const refused = refusal(id, method, params, header);
    if (refused) return refused;
  }
  const done = (result: Record<string, unknown>, cacheable = false): Reply => ({ status: 200, body: { jsonrpc: "2.0", id, result: {
    ...result,
    ...(modern ? { resultType: "complete", _meta: { [`${META}/serverInfo`]: server.info } } : {}),
    ...(modern && cacheable ? { ttlMs: LIST_TTL_MS, cacheScope: "public" } : {}),
  } } });

  if (method === "ping") return done({});
  if (method === "server/discover" && modern) {
    return done({ supportedVersions: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], capabilities: { tools: {} }, instructions: server.instructions }, true);
  }
  if (method === "tools/list") return done({ tools: server.tools }, true);
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (typeof name !== "string" || !server.tools.some(tool => tool.name === name)) return { status: 200, body: rpcError(id, -32602, `Unknown tool: ${String(name)}`) };
    if (!isObject(args)) return { status: 200, body: rpcError(id, -32602, "arguments must be an object") };
    const { text, isError } = await server.call(name, args);
    return done({ content: [{ type: "text", text }], isError });
  }
  return { status: modern ? 404 : 200, body: rpcError(id, -32601, `Method not found: ${method}`) };
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The spec's Origin check keeps web pages from reaching servers on a private
 *  network. This one is public and reads no cookies or credentials, so any web
 *  origin may call it (browser-based agents do); only a malformed or opaque
 *  Origin, such as a sandboxed frame's "null", is refused. */
export function validOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return /^https?:\/\/[^/?#\s]+$/i.test(origin);
}

export function createMcpHandler(server: McpServer, send: (req: IncomingMessage, res: ServerResponse, data: unknown, status: number) => Promise<void>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return send(req, res, rpcError(null, -32600, "This is an MCP endpoint: POST JSON-RPC messages to it."), 405);
    }
    const origin = req.headers.origin;
    if (!validOrigin(origin)) return send(req, res, rpcError(null, -32600, "Invalid Origin"), 403);
    const body = await readBody(req);
    if (!body) return send(req, res, rpcError(null, -32600, "Request too large"), 413);
    let message: unknown;
    try { message = JSON.parse(body.toString("utf8")); } catch { return send(req, res, rpcError(null, -32700, "Parse error"), 400); }
    const header = (name: string) => { const value = req.headers[name]; return Array.isArray(value) ? value.join(", ") : value; };
    const reply = await answerMcp(server, message, header);
    if (reply.body === undefined) {
      res.writeHead(reply.status);
      res.end();
      return;
    }
    return send(req, res, reply.body, reply.status);
  };
}
