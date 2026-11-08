export const OTHER_PATH = "(other)";

const SEGMENT = /^[a-z0-9-]{1,100}$/;

type Routes = Map<string, string[][]>;
let cached: { raw: string; routes: Routes } | undefined;

/** Parses ALLOWED_PATHS once per isolate: {"site": ["/", "/blog", "/blog/*"]}, where * is one slug segment. */
function parse(raw: string): Routes {
  if (cached?.raw === raw) return cached.routes;
  const routes: Routes = new Map();
  for (const [site, patterns] of Object.entries(JSON.parse(raw) as Record<string, string[]>)) {
    routes.set(
      site,
      patterns.map((p) => p.split("/").filter(Boolean)),
    );
  }
  cached = { raw, routes };
  return routes;
}

/** Returns the path when it is one of the site's pages, otherwise OTHER_PATH, so arbitrary strings are never stored. */
export function normalisePath(site: string, path: string, raw: string): string {
  const segments = path.split("/").filter(Boolean);
  const patterns = parse(raw).get(site) ?? [];
  const match = patterns.some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((part, i) => (part === "*" ? SEGMENT.test(segments[i] ?? "") : part === segments[i])),
  );
  return match ? `/${segments.join("/")}` : OTHER_PATH;
}
