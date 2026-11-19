#!/usr/bin/env python3
"""Writes grafana/dashboard.json. Run after editing the panels below: python3 grafana/build.py

Columns (see src/index.ts): index1 site; blob1 event, blob2 path, blob3 label, blob4 referrer host,
blob5 utm source, blob6 country, blob7 device, blob8 browser, blob9 os, blob10 language;
double1 engaged ms, double2 visit flag. Every count weights by _sample_interval.
"""

import json
from pathlib import Path

DS = {"type": "vertamedia-clickhouse-datasource", "uid": "${DS_BEACON}"}
TABLE = "beacon_events"
SITE = "index1 = '$site'"
W = "_sample_interval"
VIEWS = f"sum(if(blob1 = 'pageview', {W}, 0))"
# The Analytics Engine dialect has no greatest(), and if() branches must share a type (0.0 for doubles)
ENGAGED_PER_VIEW = f"if({VIEWS} = 0, 0.0, sum(if(blob1 = 'engaged', {W} * double1, 0.0)) / {VIEWS} / 1000)"


def query(sql: str, fmt: str) -> dict:
    return {"datasource": DS, "refId": "A", "query": " ".join(sql.split()), "format": fmt, "dateTimeColDataType": "timestamp", "rawQuery": True}


def panel(pid: int, title: str, kind: str, sql: str, grid: tuple[int, int, int, int], fmt: str = "table", unit: str | None = None) -> dict:
    x, y, w, h = grid
    p = {"id": pid, "title": title, "type": kind, "datasource": DS, "gridPos": {"x": x, "y": y, "w": w, "h": h}, "targets": [query(sql, fmt)]}
    if unit:
        p["fieldConfig"] = {"defaults": {"unit": unit}, "overrides": []}
    return p


def top(column: str, label: str, event: str = "pageview", extra: str = "") -> str:
    return f"""SELECT {column} AS {label}, sum({W}) AS views FROM {TABLE}
        WHERE $timeFilter AND {SITE} AND blob1 = '{event}' {extra}
        GROUP BY {label} ORDER BY views DESC LIMIT 20"""


panels = [
    panel(1, "Views", "stat", f"SELECT sum({W}) AS views FROM {TABLE} WHERE $timeFilter AND {SITE} AND blob1 = 'pageview'", (0, 0, 6, 4)),
    panel(2, "Visits", "stat", f"SELECT sum({W} * double2) AS visits FROM {TABLE} WHERE $timeFilter AND {SITE} AND blob1 = 'pageview'", (6, 0, 6, 4)),
    panel(
        3,
        "Engaged time per view",
        "stat",
        f"""SELECT {ENGAGED_PER_VIEW} AS seconds FROM {TABLE} WHERE $timeFilter AND {SITE}""",
        (12, 0, 6, 4),
        unit="s",
    ),
    panel(4, "Clicks", "stat", f"SELECT sum({W}) AS clicks FROM {TABLE} WHERE $timeFilter AND {SITE} AND blob1 IN ('click', 'outbound')", (18, 0, 6, 4)),
    panel(
        5,
        "Views and visits",
        "timeseries",
        f"""SELECT $timeSeries AS t, sum({W}) AS views, sum({W} * double2) AS visits FROM {TABLE}
            WHERE $timeFilter AND {SITE} AND blob1 = 'pageview' GROUP BY t ORDER BY t""",
        (0, 4, 24, 8),
        fmt="time_series",
    ),
    panel(
        6,
        "Pages",
        "table",
        f"""SELECT blob2 AS page, sum(if(blob1 = 'pageview', {W}, 0)) AS views, sum(if(blob1 = 'pageview', {W} * double2, 0.0)) AS visits,
            round({ENGAGED_PER_VIEW}, 1) AS engaged_s_per_view
            FROM {TABLE} WHERE $timeFilter AND {SITE} AND blob1 IN ('pageview', 'engaged')
            GROUP BY page ORDER BY views DESC LIMIT 50""",
        (0, 12, 24, 10),
    ),
    # One row per photo page, so the most opened photos are not crowded out of Pages' 50 rows
    panel(
        16,
        "Photos",
        "table",
        f"""SELECT blob2 AS photo, sum(if(blob1 = 'pageview', {W}, 0)) AS views, sum(if(blob1 = 'pageview', {W} * double2, 0.0)) AS visits,
            round({ENGAGED_PER_VIEW}, 1) AS engaged_s_per_view
            FROM {TABLE} WHERE $timeFilter AND {SITE} AND blob1 IN ('pageview', 'engaged') AND blob2 LIKE '/gallery/%'
            GROUP BY photo ORDER BY views DESC LIMIT 200""",
        (0, 22, 24, 10),
    ),
    panel(7, "Referrers", "table", top("blob4", "referrer", extra="AND double2 = 1 AND blob4 != ''"), (0, 32, 8, 9)),
    panel(8, "Campaigns (utm_source)", "table", top("blob5", "source", extra="AND blob5 != ''"), (8, 32, 8, 9)),
    panel(9, "Countries", "table", top("blob6", "country"), (16, 32, 8, 9)),
    panel(10, "Devices", "piechart", top("blob7", "device"), (0, 41, 6, 8)),
    panel(11, "Browsers", "piechart", top("blob8", "browser"), (6, 41, 6, 8)),
    panel(12, "Operating systems", "piechart", top("blob9", "os"), (12, 41, 6, 8)),
    panel(13, "Languages", "piechart", top("blob10", "language"), (18, 41, 6, 8)),
    panel(
        14,
        "Clicks (data-event)",
        "table",
        f"""SELECT blob3 AS event, blob2 AS page, sum({W}) AS clicks FROM {TABLE}
            WHERE $timeFilter AND {SITE} AND blob1 = 'click' GROUP BY event, page ORDER BY clicks DESC LIMIT 50""",
        (0, 49, 12, 10),
    ),
    panel(
        15,
        "Outbound links",
        "table",
        f"""SELECT blob3 AS destination, sum({W}) AS clicks FROM {TABLE}
            WHERE $timeFilter AND {SITE} AND blob1 = 'outbound' GROUP BY destination ORDER BY clicks DESC LIMIT 50""",
        (12, 49, 12, 10),
    ),
]

dashboard = {
    "__inputs": [{"name": "DS_BEACON", "label": "Analytics Engine", "type": "datasource", "pluginId": "vertamedia-clickhouse-datasource", "pluginName": "Altinity plugin for ClickHouse"}],
    "title": "Site analytics",
    "uid": "beacon-sites",
    "timezone": "browser",
    "time": {"from": "now-30d", "to": "now"},
    "refresh": "",
    "schemaVersion": 39,
    "templating": {
        "list": [
            {
                "name": "site",
                "label": "Site",
                "type": "custom",
                "query": "felix-hzv.dev,cofr.cash",
                "current": {"text": "felix-hzv.dev", "value": "felix-hzv.dev"},
                "options": [{"text": s, "value": s, "selected": s == "felix-hzv.dev"} for s in ("felix-hzv.dev", "cofr.cash")],
            }
        ]
    },
    "panels": panels,
}

out = Path(__file__).with_name("dashboard.json")
out.write_text(json.dumps(dashboard, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {out}")
