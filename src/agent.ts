export interface Agent {
  bot: boolean;
  device: "mobile" | "tablet" | "desktop";
  browser: string;
  os: string;
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|go-http/i;

// First match wins, so more specific tokens come first (Edge and Opera also send "Chrome").
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "edge"],
  [/OPR\/|Opera/, "opera"],
  [/SamsungBrowser\//, "samsung"],
  [/Firefox\/|FxiOS\//, "firefox"],
  [/Chrome\/|CriOS\//, "chrome"],
  [/Safari\//, "safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "windows"],
  [/iPhone|iPad|iPod/, "ios"],
  [/Android/, "android"],
  [/CrOS/, "chromeos"],
  [/Mac OS X|Macintosh/, "macos"],
  [/Linux/, "linux"],
];

/** Coarse classification only; the header itself is never stored. */
export function classify(userAgent: string | null): Agent {
  const ua = userAgent ?? "";
  const pick = (table: [RegExp, string][]) => table.find(([pattern]) => pattern.test(ua))?.[1] ?? "other";
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? "tablet" : /Mobi|iPhone|iPod|Android/i.test(ua) ? "mobile" : "desktop";
  return { bot: !ua || BOT.test(ua), device, browser: pick(BROWSERS), os: pick(SYSTEMS) };
}
