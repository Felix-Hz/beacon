// Cookieless analytics client, served by the Worker at /b.js and loaded with
// <script defer src="https://e.felix-hzv.dev/b.js">. No identifiers, no storage.
(() => {
  const script = document.currentScript;
  if (!script || !navigator.sendBeacon) return;
  const endpoint = new URL("/e", script.src).href;
  const send = (body) => navigator.sendBeacon(endpoint, JSON.stringify(body));

  const referrer = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      return "";
    }
  })();
  let path = location.pathname;
  let visibleSince = document.visibilityState === "visible" ? performance.now() : 0;
  let engaged = 0;

  const pageview = (visit) => {
    const event = { e: "pageview", p: path, v: visit ? 1 : 0 };
    const lang = (navigator.language || "").split("-")[0].toLowerCase();
    if (/^[a-z]{2,3}$/.test(lang)) event.lang = lang;
    if (visit) {
      const source = new URLSearchParams(location.search).get("utm_source");
      if (source) event.u = source.slice(0, 64);
      if (referrer) event.r = referrer;
    }
    send(event);
  };

  // Engaged time accrues only while the tab is visible and is sent in chunks, one per
  // hide or route change, so the per-path total is the sum of chunks.
  const flush = () => {
    if (visibleSince) {
      engaged += performance.now() - visibleSince;
      visibleSince = 0;
    }
    if (engaged >= 1000) send({ e: "engaged", p: path, ms: Math.min(Math.round(engaged), 1800000) });
    engaged = 0;
  };

  const routeChanged = () => {
    if (location.pathname === path) return;
    flush();
    path = location.pathname;
    if (document.visibilityState === "visible") visibleSince = performance.now();
    pageview(false);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else visibleSince = performance.now();
  });
  addEventListener("pagehide", flush);
  addEventListener("popstate", routeChanged);
  const push = history.pushState;
  history.pushState = function (...args) {
    const result = push.apply(this, args);
    routeChanged();
    return result;
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element && event.target.closest("[data-event],a[href]");
      if (!target) return;
      const name = target.getAttribute("data-event");
      if (name) return void send({ e: "click", p: path, l: name.slice(0, 64) });
      const url = new URL(target.href, location.href);
      if (url.protocol === "mailto:") send({ e: "outbound", p: path, l: "mailto" });
      else if (/^https?:$/.test(url.protocol) && url.hostname !== location.hostname) send({ e: "outbound", p: path, l: url.hostname });
    },
    { capture: true },
  );

  // A visit is a page load from another site or with no referrer, not an in-site navigation.
  pageview(referrer !== location.hostname);
})();
