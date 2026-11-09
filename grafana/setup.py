#!/usr/bin/env python3
"""Creates the Analytics Engine data source and the dashboard in a Grafana stack.

    python3 grafana/setup.py            create or update both
    python3 grafana/setup.py --check    report what exists, change nothing

Reads two Bitwarden items through the bw CLI (BW_SESSION, or the key in ~/.bw_session):
  "Grafana - service account token"    password: the token; URI or username: the stack, https://{name}.grafana.net
  "Cloudflare - analytics read token"  password: a Cloudflare token with Account Analytics Read only
Neither value is printed or written to disk. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT_ID = "93e391b9970b913d3c84519a8965fb2e"
DS_NAME = "Analytics Engine"
DS_UID = "beacon-analytics-engine"
PLUGIN = "vertamedia-clickhouse-datasource"
DASHBOARD = Path(__file__).with_name("dashboard.json")


def bw_item(name: str) -> dict:
    exe = shutil.which("bw") or os.environ.get("BW_BIN")
    if not exe:
        packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        exe = next((str(p / "bw.exe") for p in packages.glob("Bitwarden.CLI_*") if (p / "bw.exe").exists()), None)
    if not exe:
        sys.exit("Bitwarden CLI not found")
    env = dict(os.environ)
    session = Path.home() / ".bw_session"
    if not env.get("BW_SESSION") and session.exists():
        env["BW_SESSION"] = session.read_text(encoding="utf-8").strip()
    result = subprocess.run([exe, "get", "item", name], capture_output=True, text=True, env=env)
    if result.returncode != 0:
        sys.exit(f"bw get item {name!r}: {result.stderr.strip()}")
    return json.loads(result.stdout)


class Grafana:
    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"}

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            # Grafana error bodies carry a message, never the submitted secrets
            return error.code, json.loads(error.read() or b"{}")


def datasource(cf_token: str) -> dict:
    return {
        "uid": DS_UID,
        "name": DS_NAME,
        "type": PLUGIN,
        "access": "proxy",
        "url": f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/analytics_engine/sql",
        "basicAuth": False,
        "jsonData": {"usePOST": True, "httpHeaderName1": "Authorization"},
        "secureJsonData": {"httpHeaderValue1": f"Bearer {cf_token}"},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    item = bw_item("Grafana - service account token")
    login = item.get("login") or {}
    candidates = [u.get("uri", "") for u in login.get("uris") or []] + [login.get("username") or ""]
    stack = next((c for c in candidates if c.startswith("https://") and ".grafana.net" in c), "")
    if not stack:
        sys.exit('Set the stack URL (https://{name}.grafana.net) as the URI or username of "Grafana - service account token"')
    grafana = Grafana(stack, item["login"]["password"])

    status, plugin = grafana.call("GET", f"/api/plugins/{PLUGIN}/settings")
    if status != 200:
        sys.exit(f"plugin {PLUGIN} is not installed on {stack} (HTTP {status}); install it under Administration > Plugins")
    status, existing = grafana.call("GET", f"/api/datasources/uid/{DS_UID}")
    print(f"stack {stack}: plugin {plugin.get('info', {}).get('version', '?')}, data source {'present' if status == 200 else 'missing'}")
    if args.check:
        return 0

    body = datasource(bw_item("Cloudflare - analytics read token")["login"]["password"])
    if status == 200:
        status, result = grafana.call("PUT", f"/api/datasources/uid/{DS_UID}", body)
    else:
        status, result = grafana.call("POST", "/api/datasources", body)
    if status != 200:
        sys.exit(f"data source: HTTP {status} {result.get('message', '')}")
    status, health = grafana.call("GET", f"/api/datasources/uid/{DS_UID}/health")
    print(f"data source saved; health: {health.get('status', status)} {health.get('message', '')}".rstrip())

    dashboard = json.loads(DASHBOARD.read_text(encoding="utf-8").replace("${DS_BEACON}", DS_UID))
    dashboard.pop("__inputs", None)
    dashboard.pop("id", None)
    status, result = grafana.call("POST", "/api/dashboards/db", {"dashboard": dashboard, "overwrite": True, "message": "grafana/setup.py"})
    if status != 200:
        sys.exit(f"dashboard: HTTP {status} {result.get('message', '')}")
    print(f"dashboard: {grafana.url}{result.get('url', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
