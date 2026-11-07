# beacon

Cookieless page analytics on a Cloudflare Worker. Sites load one script, events go to Workers Analytics Engine, and Grafana reads them.

## Add it to a site

```html
<script defer src="https://e.felix-hzv.dev/b.js"></script>
```

Then add the site's origin to `ALLOWED_ORIGINS` in `wrangler.jsonc`. Requests from any other origin are rejected.

To count a click, give the element a `data-event` name:

```html
<a href="/pricing" data-event="cta:pricing">Pricing</a>
```

## What gets recorded

- `pageview`: path, referring site, `utm_source`, language, and whether it started a visit
- `click`: path and the `data-event` name
- `outbound`: path and the destination host
- `engaged`: path and how long the tab was visible

Each event also gets the site, country, device type, browser and OS. There are no cookies and no IDs, so visits can't be linked to each other or to a person. The IP is only used for rate limiting and is never stored. Bots are dropped. Data is kept for three months.

## Develop

Needs Node 22+.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run check   # bundle without deploying
```

Pushes to `main` deploy through `deploy.yml`, using the `CLOUDFLARE_API_TOKEN` secret (Workers Scripts edit) and the `CLOUDFLARE_ACCOUNT_ID` variable.

## Query

Dataset `beacon_events`. Weight counts by `_sample_interval`.

| Column              | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `index1`            | site                                                                             |
| `blob1` to `blob10` | event, path, label, referrer, utm source, country, device, browser, OS, language |
| `double1`           | engaged milliseconds                                                             |
| `double2`           | 1 if the page view started a visit                                               |

```sql
SELECT blob2 AS page, sum(_sample_interval) AS views
FROM beacon_events
WHERE timestamp > NOW() - INTERVAL '7' DAY AND index1 = 'felix-hzv.dev' AND blob1 = 'pageview'
GROUP BY page ORDER BY views DESC LIMIT 20
```

## Grafana

Install the Altinity ClickHouse plugin and add a data source pointing at `https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql`. Turn off its auth options and add the header `Authorization: Bearer {token}`, using a token with Account Analytics read. Then import `grafana/dashboard.json`.
