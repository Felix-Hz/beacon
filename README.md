<p align="center"><img src="assets/icon.svg" width="72" height="72" alt=""></p>

<h1 align="center">beacon</h1>

<p align="center">Cookieless page analytics on a Cloudflare Worker: one script on each site, events in Workers Analytics Engine, charts in Grafana.</p>

---

beacon counts page views, clicks, outbound links and reading time without cookies, identifiers or a consent banner. A site loads a 3 KB script; the Worker checks every event, drops bots and anything malformed, and writes what's left to Workers Analytics Engine. Grafana reads it with SQL.

It runs at `e.felix-hzv.dev` for felix-hzv.dev and at `e.cofr.cash` for the cofr landing page.

## Contents

- [Add it to a site](#add-it-to-a-site)
- [What gets recorded](#what-gets-recorded)
- [Privacy and safeguards](#privacy-and-safeguards)
- [Querying](#querying)
- [Grafana](#grafana)
- [Development](#development)
- [Deployment](#deployment)
- [Architecture](#architecture)

## Add it to a site

1. Load the script:

   ```html
   <script defer src="https://e.felix-hzv.dev/b.js"></script>
   ```

2. Add the site's origin to `ALLOWED_ORIGINS` in `wrangler.jsonc`. Events from any other origin are rejected.
3. List the site's pages in `ALLOWED_PATHS` in the same file. `*` matches one slug segment, so `"/blog/*"` covers every post. Any other path is stored as `(other)`.

For a site on another domain, attach a hostname on that domain's zone to the same Worker and load the script from there; cofr.cash uses `e.cofr.cash`. Content blockers drop cross-site beacons, and a same-site one gets through.

To count a click, give the element a `data-event` name:

```html
<a href="/pricing" data-event="cta:pricing">Pricing</a>
```

## What gets recorded

| Event      | Recorded with                                                            |
| ---------- | ------------------------------------------------------------------------ |
| `pageview` | path, referring site, `utm_source`, language, whether it started a visit |
| `click`    | path and the `data-event` name                                           |
| `outbound` | path and the destination host                                            |
| `engaged`  | path and how long the tab was visible, up to 30 minutes                  |

Every event also carries the site, country, device type, browser and operating system.

## Privacy and safeguards

- **Nothing identifies a visitor.** No cookies, no storage, no IDs, so visits can't be linked to each other or to a person.
- **The IP address is never stored.** It's used only to rate-limit, then dropped.
- **Only known pages are stored.** Paths outside a site's `ALLOWED_PATHS` are recorded as `(other)`, so query strings, tokens or typos never reach the dataset.
- **Only real browser beacons are accepted.** An event must come from an allowed origin, as a `navigator.sendBeacon` request with matching `Sec-Fetch` headers, under 1 KB, with every field in its expected format.
- **Rate limited.** 60 events a minute per IP; more get `429`.
- **Bots are dropped.** They get `204` so they don't retry, and aren't counted.
- **Kept for three months**, the Analytics Engine retention period.

## Querying

Dataset `beacon_events`. Weight counts by `_sample_interval`.

| Column              | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `index1`            | site                                                                             |
| `blob1` to `blob10` | event, path, label, referrer, utm source, country, device, browser, OS, language |
| `double1`           | engaged milliseconds                                                             |
| `double2`           | 1 if the page view started a visit                                               |

Top pages on felix-hzv.dev over the last week:

```sql
SELECT blob2 AS page, sum(_sample_interval) AS views
FROM beacon_events
WHERE timestamp > NOW() - INTERVAL '7' DAY AND index1 = 'felix-hzv.dev' AND blob1 = 'pageview'
GROUP BY page ORDER BY views DESC LIMIT 20
```

## Grafana

**Automatic.** `python3 grafana/setup.py` reads a Grafana service account token and the Cloudflare token from Bitwarden, creates the data source and imports the dashboard. Panels are defined in `grafana/build.py`.

**By hand.** Install the Altinity ClickHouse plugin and add a data source pointing at `https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql`. Turn off its auth options and add the header `Authorization: Bearer {token}`, using a token with Account Analytics read. Then import `grafana/dashboard.json`.

## Development

Needs Node 22 or later.

```sh
npm ci
npm test            # Worker tests in the Workers runtime
npm run typecheck
npm run lint
npm run check       # bundle without deploying
npm run dev         # local Worker
```

The icon is drawn on a 16-pixel grid in `scripts/make-icon.mjs`; run `node scripts/make-icon.mjs` after changing it.

## Deployment

Every push to `main` runs the tests and deploys the Worker through `.github/workflows/deploy.yml`. It uses the `CLOUDFLARE_API_TOKEN` secret (Workers Scripts edit on this account only) and the `CLOUDFLARE_ACCOUNT_ID` variable. Custom domains are attached once through the API, so the deploy token needs no zone permissions.

## Architecture

```
client/beacon.js   the browser script, served by the Worker at /b.js
src/index.ts       routing, origin and header checks, rate limit, write to Analytics Engine
src/event.ts       event validation: every field checked against its format and range
src/routes.ts      ALLOWED_PATHS matching; anything else becomes (other)
src/agent.ts       bot detection and coarse device, browser and OS classification
grafana/           dashboard definition and setup script
```

- **No storage of its own.** Events go straight to Workers Analytics Engine, which samples at high volume; `_sample_interval` restores true counts.
- **Configuration in `wrangler.jsonc`.** Allowed origins, allowed paths and the rate limit live there, so a new site is a config change and a deploy.
