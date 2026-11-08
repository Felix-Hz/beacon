import client from "../client/beacon.js" with { type: "text" };
import { classify } from "./agent";
import { MAX_BODY, parseEvent } from "./event";
import { normalisePath } from "./routes";

const SCRIPT_HEADERS = {
  "Content-Type": "text/javascript; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
  "X-Content-Type-Options": "nosniff",
};

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const empty = (status: number, headers?: Record<string, string>) => new Response(null, { status, headers });

// What navigator.sendBeacon sends with a text/plain body. Scripts that forge Origin rarely set these.
const FETCH_SITES = new Set(["same-site", "cross-site"]);
const FETCH_MODES = new Set(["no-cors", "cors"]);

function fromBrowserBeacon(headers: Headers): boolean {
  return (
    (headers.get("Content-Type") ?? "").startsWith("text/plain") &&
    FETCH_SITES.has(headers.get("Sec-Fetch-Site") ?? "") &&
    FETCH_MODES.has(headers.get("Sec-Fetch-Mode") ?? "")
  );
}

async function collect(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",");
  if (!allowed.includes(origin)) return empty(403);
  const headers = cors(origin);
  if (request.method === "OPTIONS") return empty(204, headers);
  if (request.method !== "POST") return empty(405, { ...headers, Allow: "POST, OPTIONS" });

  if (!fromBrowserBeacon(request.headers)) return empty(403, headers);

  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY) return empty(413, headers);

  const agent = classify(request.headers.get("User-Agent"));
  // Bots get a 204 so they don't retry, but are not counted.
  if (agent.bot) return empty(204, headers);

  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return empty(429, headers);

  const body = await request.text();
  if (body.length > MAX_BODY) return empty(413, headers);
  const event = parseEvent(body);
  if (!event) return empty(400, headers);

  const site = new URL(origin).hostname;
  const country = typeof request.cf?.country === "string" ? request.cf.country : "";
  env.EVENTS.writeDataPoint({
    indexes: [site],
    blobs: [
      event.e,
      normalisePath(site, event.p, env.ALLOWED_PATHS),
      event.l,
      event.r,
      event.u,
      country,
      agent.device,
      agent.browser,
      agent.os,
      event.lang,
    ],
    doubles: [event.ms, event.v],
  });
  return empty(204, headers);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/e") return collect(request, env);
    if (pathname === "/b.js" && request.method === "GET") return new Response(client, { headers: SCRIPT_HEADERS });
    return empty(404);
  },
} satisfies ExportedHandler<Env>;
