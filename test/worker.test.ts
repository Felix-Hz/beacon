import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { classify } from "../src/agent";
import { parseEvent } from "../src/event";
import worker from "../src/index";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

let points: AnalyticsEngineDataPoint[];
let allow: boolean;
let limitedKeys: string[];

const testEnv = (): Env =>
  ({
    ...env,
    ALLOWED_ORIGINS: "https://felix-hzv.dev,https://cofr.cash",
    ALLOWED_PATHS: JSON.stringify({ "felix-hzv.dev": ["/", "/blog", "/blog/*"], "cofr.cash": ["/", "/terms", "/privacy"] }),
    EVENTS: { writeDataPoint: (point?: AnalyticsEngineDataPoint) => point && points.push(point) },
    LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limitedKeys.push(key);
        return { success: allow };
      },
    },
  }) as unknown as Env;

type PostInit = { origin?: string; ua?: string; raw?: string; country?: string; headers?: Record<string, string | null> };

function post(body: unknown, init: PostInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain;charset=UTF-8",
    "CF-Connecting-IP": "203.0.113.7",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "no-cors",
  };
  if (init.origin !== undefined) headers.Origin = init.origin;
  else headers.Origin = "https://felix-hzv.dev";
  headers["User-Agent"] = init.ua ?? CHROME;
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const request = new Request("https://e.felix-hzv.dev/e", {
    method: "POST",
    headers,
    body: init.raw ?? JSON.stringify(body),
    cf: { country: init.country ?? "NZ" },
  } as RequestInit);
  return worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, testEnv());
}

beforeEach(() => {
  points = [];
  allow = true;
  limitedKeys = [];
});

describe("collect", () => {
  it("writes a pageview with site index, coarse agent and country", async () => {
    const response = await post({ e: "pageview", p: "/blog/hello", v: 1, r: "News.YCombinator.com", u: "newsletter", lang: "en" });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://felix-hzv.dev");
    expect(points).toEqual([
      {
        indexes: ["felix-hzv.dev"],
        blobs: ["pageview", "/blog/hello", "", "news.ycombinator.com", "newsletter", "NZ", "desktop", "chrome", "windows", "en"],
        doubles: [0, 1],
      },
    ]);
  });

  it("rejects requests that don't look like a browser beacon", async () => {
    const cases: Record<string, string | null>[] = [
      { "Sec-Fetch-Site": null },
      { "Sec-Fetch-Mode": null },
      { "Sec-Fetch-Site": "none" },
      { "Sec-Fetch-Mode": "navigate" },
      { "Content-Type": "application/json" },
    ];
    for (const headers of cases) {
      expect((await post({ e: "pageview", p: "/" }, { headers })).status, JSON.stringify(headers)).toBe(403);
    }
    expect(points).toHaveLength(0);
  });

  it("accepts a cross-site beacon from cofr.cash", async () => {
    const response = await post({ e: "pageview", p: "/" }, { origin: "https://cofr.cash", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(response.status).toBe(204);
  });

  it("stores only known page paths, anything else as (other)", async () => {
    await post({ e: "pageview", p: "/blog/my-first-post/" });
    await post({ e: "pageview", p: "/wp-admin/setup.php" });
    await post({ e: "pageview", p: "/blog/Some.Email@example.com" });
    await post({ e: "pageview", p: "/terms" });
    await post({ e: "pageview", p: "/terms" }, { origin: "https://cofr.cash", headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(points.map((p) => p.blobs?.[1])).toEqual(["/blog/my-first-post", "(other)", "(other)", "(other)", "/terms"]);
  });

  it("takes the site from Origin, never the body", async () => {
    await post({ e: "click", p: "/", l: "cta:install", site: "evil.example" }, { origin: "https://cofr.cash" });
    expect(points[0]?.indexes).toEqual(["cofr.cash"]);
  });

  it("writes engaged time as a double", async () => {
    await post({ e: "engaged", p: "/blog/hello", ms: 42_000 }, { ua: IPHONE });
    expect(points[0]?.doubles).toEqual([42_000, 0]);
    expect(points[0]?.blobs?.slice(6, 9)).toEqual(["mobile", "safari", "ios"]);
  });

  it("rejects a foreign or missing origin", async () => {
    expect((await post({ e: "pageview", p: "/" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ e: "pageview", p: "/" }, { origin: "" })).status).toBe(403);
    expect(points).toHaveLength(0);
  });

  it("rejects malformed and out-of-range events", async () => {
    const bad = [
      { raw: "not json" },
      { raw: "[]" },
      { body: { e: "purchase", p: "/" } },
      { body: { e: "pageview", p: "blog" } },
      { body: { e: "pageview", p: "/a?b=c" } },
      { body: { e: "click", p: "/" } },
      { body: { e: "click", p: "/", l: "<script>" } },
      { body: { e: "engaged", p: "/", ms: -1 } },
      { body: { e: "engaged", p: "/", ms: 1_800_001 } },
      { body: { e: "engaged", p: "/", ms: 1.5 } },
      { body: { e: "pageview", p: "/", r: "bad host/" } },
      { body: { e: "pageview", p: "/", lang: "english" } },
    ];
    for (const { body, raw } of bad) {
      const response = await post(body, { raw });
      expect(response.status, JSON.stringify(body ?? raw)).toBe(400);
    }
    expect(points).toHaveLength(0);
  });

  it("rejects an oversized body", async () => {
    const response = await post(null, { raw: JSON.stringify({ e: "pageview", p: "/", pad: "x".repeat(2000) }) });
    expect(response.status).toBe(413);
    expect(points).toHaveLength(0);
  });

  it("drops bots without counting them", async () => {
    const response = await post({ e: "pageview", p: "/" }, { ua: "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    expect(response.status).toBe(204);
    expect(points).toHaveLength(0);
  });

  it("rate limits per client IP", async () => {
    allow = false;
    expect((await post({ e: "pageview", p: "/" })).status).toBe(429);
    expect(limitedKeys).toEqual(["203.0.113.7"]);
    expect(points).toHaveLength(0);
  });

  it("answers the CORS preflight for allowed origins", async () => {
    const request = new Request("https://e.felix-hzv.dev/e", { method: "OPTIONS", headers: { Origin: "https://cofr.cash" } });
    const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, testEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://cofr.cash");
  });
});

describe("routes", () => {
  it("serves the client script", async () => {
    const response = await worker.fetch(
      new Request("https://e.felix-hzv.dev/b.js") as Request<unknown, IncomingRequestCfProperties>,
      testEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("javascript");
    const text = await response.text();
    expect(text).toContain("sendBeacon");
    expect(text).not.toMatch(/cookie|localStorage|sessionStorage/);
  });

  it("returns 404 elsewhere", async () => {
    const response = await worker.fetch(
      new Request("https://e.felix-hzv.dev/") as Request<unknown, IncomingRequestCfProperties>,
      testEnv(),
    );
    expect(response.status).toBe(404);
  });
});

describe("parseEvent", () => {
  it("ignores unknown keys and defaults optional fields", () => {
    expect(parseEvent(JSON.stringify({ e: "pageview", p: "/", extra: true }))).toEqual({
      e: "pageview",
      p: "/",
      l: "",
      r: "",
      u: "",
      lang: "",
      ms: 0,
      v: 0,
    });
  });
});

describe("classify", () => {
  it("separates tablets from phones", () => {
    expect(classify("Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/141.0 Safari/537.36").device).toBe("tablet");
    expect(classify("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36").device).toBe("mobile");
  });

  it("names Edge before Chrome and treats a missing agent as a bot", () => {
    expect(classify(`${CHROME} Edg/141.0`).browser).toBe("edge");
    expect(classify(null).bot).toBe(true);
  });
});
