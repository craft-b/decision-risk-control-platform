#!/usr/bin/env python3
"""
monitor.py — Local agent cron script for Enterprise Asset Intelligence.

Checks model health via the agent API and takes action automatically:
  - NO_DATA drift  → compute_drift_reference
  - ALERT drift    → retrain
  - STABLE / WARNING → log and exit

Usage:
    python monitor.py                     # one-shot check
    python monitor.py --dry-run           # check only, no actions taken

Schedule with cron (example: nightly at 2am):
    0 2 * * * cd /path/to/project && venv/Scripts/python.exe monitor.py

Requirements:
    - Node server must be running on port 5000
    - AGENT_API_KEY must be set in .env or as env var
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[ERROR] requests not installed — run: pip install requests")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

def load_env():
    """Load .env from project root if running from the project directory."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

load_env()

BASE_URL  = os.environ.get("NODE_URL", "http://localhost:5000")
API_KEY   = os.environ.get("AGENT_API_KEY", "")
HEADERS   = {"Authorization": f"Bearer {API_KEY}"}

def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def log(msg: str):
    print(f"[{ts()}] {msg}")

# ── API calls ─────────────────────────────────────────────────────────────────

def get_health() -> dict:
    resp = requests.get(f"{BASE_URL}/api/agent/model-health", headers=HEADERS, timeout=10)
    resp.raise_for_status()
    return resp.json()

def trigger_action(action: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/agent/actions",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"action": action},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Enterprise Asset Intelligence — model health monitor")
    parser.add_argument("--dry-run", action="store_true", help="Check health but take no action")
    args = parser.parse_args()

    if not API_KEY:
        log("ERROR: AGENT_API_KEY not set. Add it to .env or export it as an env var.")
        sys.exit(1)

    log("Checking model health...")

    try:
        health = get_health()
    except requests.exceptions.ConnectionError:
        log("ERROR: Cannot reach server at " + BASE_URL + ". Is it running?")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        log(f"ERROR: {e.response.status_code} — {e.response.text}")
        sys.exit(1)

    action    = health.get("recommended_action", "none")
    reasoning = health.get("reasoning", "")
    drift     = health.get("drift", {})
    model     = health.get("model")

    log(f"Model   : {model['version'] if model else 'none'}")
    log(f"Drift   : {drift.get('overall', 'NO_DATA')}")
    for f in drift.get("features", []):
        log(f"  {f['feature']}: PSI={f['psi']:.4f}  [{f['status']}]")
    log(f"Action  : {action}")
    log(f"Reason  : {reasoning}")

    if action == "none":
        log("Nothing to do — model is healthy.")
        return

    if args.dry_run:
        log(f"DRY RUN — would trigger: {action}")
        return

    log(f"Triggering: {action}...")
    try:
        result = trigger_action(action)
        log(f"Done: {json.dumps(result)}")
    except requests.exceptions.HTTPError as e:
        log(f"Action failed: {e.response.status_code} — {e.response.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
