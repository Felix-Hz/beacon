export const EVENTS = ["pageview", "click", "outbound", "engaged"] as const;
export type EventName = (typeof EVENTS)[number];

export interface BeaconEvent {
  e: EventName;
  p: string;
  l: string;
  r: string;
  u: string;
  lang: string;
  ms: number;
  v: number;
}

export const MAX_BODY = 1024;
const MAX_ENGAGED_MS = 1_800_000;
const PATH = /^\/[^\s?#\p{Cc}]{0,199}$/u;
const LABEL = /^[\w:./@-]{1,64}$/;
const HOST = /^[a-z0-9.-]{1,253}$/i;
const SOURCE = /^[\w.-]{1,64}$/;
const LANG = /^[a-z]{2,3}$/;

function optional(value: unknown, pattern: RegExp): string | null {
  if (value === undefined) return "";
  return typeof value === "string" && pattern.test(value) ? value : null;
}

/** Returns the event, or null when any field is missing, malformed or out of range. Unknown keys are ignored. */
export function parseEvent(body: string): BeaconEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;

  const e = data.e;
  if (typeof e !== "string" || !(EVENTS as readonly string[]).includes(e)) return null;
  if (typeof data.p !== "string" || !PATH.test(data.p)) return null;

  const l = optional(data.l, LABEL);
  const r = optional(data.r, HOST);
  const u = optional(data.u, SOURCE);
  const lang = optional(data.lang, LANG);
  if (l === null || r === null || u === null || lang === null) return null;
  if ((e === "click" || e === "outbound") && !l) return null;

  let ms = 0;
  if (e === "engaged") {
    if (!Number.isInteger(data.ms) || (data.ms as number) < 0 || (data.ms as number) > MAX_ENGAGED_MS) return null;
    ms = data.ms as number;
  }
  const v = e === "pageview" && data.v === 1 ? 1 : 0;

  return { e: e as EventName, p: data.p, l, r: r.toLowerCase(), u, lang, ms, v };
}
