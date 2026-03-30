#!/usr/bin/env python3
"""
monitor.py — Autonomous ML health monitor for Enterprise Asset Intelligence.

Polls /api/agent/model-health, reports status, and auto-triggers remediation
actions (retrain or drift-reference compute) when warranted.

Usage:
    python monitor.py                        # single run, auto-act
    python monitor.py --dry-run              # report only, never trigger
    python monitor.py --loop 3600            # run every 3600s (1 hour)
    python monitor.py --loop 21600 --wait    # run every 6h, wait for retrain
    python monitor.py --json                 # dump raw health JSON and exit

Environment variables:
    AGENT_API_KEY   — required; must match NODE_URL server's AGENT_API_KEY
    NODE_URL        — default http://localhost:5000

Cron example (every 6 hours, nightly retrain window):
    0 */6 * * * cd /path/to/project && AGENT_API_KEY=your-key \\
        venv/Scripts/python.exe monitor.py --wait >> logs/monitor.log 2>&1
"""

import argparse
import json
import os
import sys
import textwrap
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("[ERROR] requests not installed — run: pip install requests")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

def _load_env():
    """Load .env from project root so the script works without exporting vars."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())

_load_env()

BASE_URL = os.environ.get("NODE_URL", "http://localhost:5000")
API_KEY  = os.environ.get("AGENT_API_KEY", "")
HEADERS  = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# Actions this monitor is allowed to trigger autonomously.
# Remove an entry to make it advisory-only for that action.
AUTO_ACTIONS = {"retrain", "compute_drift_reference"}


# ─────────────────────────────────────────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

def ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def log(msg: str, level: str = "INFO"):
    print(f"[{ts()}] [{level:5s}] {msg}", flush=True)

def section(title: str):
    width = 62
    print(f"\n{'─' * width}")
    print(f"  {title}")
    print(f"{'─' * width}", flush=True)

def _status_icon(status: str) -> str:
    return {"STABLE": "✅", "WARNING": "⚠️ ", "ALERT": "🚨", "NO_DATA": "❓"}.get(status, "   ")

def _psi_bar(psi: float, alert: float = 0.20, width: int = 20) -> str:
    filled = min(int(psi / alert * width), width)
    return "█" * filled + "░" * (width - filled)


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────

def get_health() -> dict:
    if not API_KEY:
        log("AGENT_API_KEY not set — add it to .env or export it", "ERROR")
        sys.exit(1)
    try:
        res = requests.get(f"{BASE_URL}/api/agent/model-health", headers=HEADERS, timeout=15)
        res.raise_for_status()
        return res.json()
    except requests.ConnectionError:
        log(f"Cannot connect to {BASE_URL} — is the server running?", "ERROR")
        sys.exit(1)
    except requests.HTTPError:
        log(f"HTTP {res.status_code}: {res.text[:200]}", "ERROR")
        sys.exit(1)

def trigger_action(action: str) -> dict:
    res = requests.post(
        f"{BASE_URL}/api/agent/actions",
        headers=HEADERS,
        json={"action": action},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()

def get_training_status() -> dict:
    try:
        res = requests.get(f"{BASE_URL}/api/ml/train/status", headers=HEADERS, timeout=10)
        if res.ok:
            return res.json()
    except Exception:
        pass
    return {}

def get_drift_summary() -> dict:
    """Fetch full three-layer drift summary (data + prediction + bias)."""
    try:
        res = requests.get(f"{BASE_URL}/api/ml/drift/summary", headers=HEADERS, timeout=10)
        if res.ok:
            return res.json()
    except Exception:
        pass
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# REPORT
# ─────────────────────────────────────────────────────────────────────────────

def report(health: dict, drift_summary: dict):
    section(f"ENTERPRISE ASSET INTELLIGENCE — MONITOR  [{ts()}]")
    log(f"Base URL   : {BASE_URL}")

    # ── Model ──────────────────────────────────────────────────────────────
    section("MODEL")
    model = health.get("model")
    if model:
        log(f"Version    : {model['version']}")
        log(f"Trained at : {model['trained_at']}")
        log(f"Accuracy   : {model['accuracy']:.1%}")
        log(f"Dataset    : {model['dataset_size']:,} samples")
    else:
        log("No trained model found — run a seed + train cycle", "WARN")

    # ── Pipeline ───────────────────────────────────────────────────────────
    section("PIPELINE")
    pipe = health.get("pipeline", {})
    labeled   = pipe.get("snapshots_labeled", 0)
    total_s   = pipe.get("snapshots_total", 0)
    pct       = labeled / total_s * 100 if total_s else 0
    log(f"Snapshots  : {total_s:,} total / {labeled:,} labeled ({pct:.0f}%)")
    log(f"Predictions: {pipe.get('predictions_total', 0):,}")
    log(f"Training   : {'▶ RUNNING' if pipe.get('training_running') else 'idle'}")
    log(f"Train-ready: {'yes (>100 labeled)' if pipe.get('ready_for_training') else 'no (<100 labeled)'}")

    # ── Feature drift ──────────────────────────────────────────────────────
    section("FEATURE DRIFT  (PSI vs. training distribution)")
    feat_drift = drift_summary.get("data_drift") or health.get("drift", {})
    overall_feat = feat_drift.get("overall", feat_drift.get("status", "NO_DATA"))
    log(f"Overall    : {_status_icon(overall_feat)} {overall_feat}")
    features = feat_drift.get("features", [])
    for f in sorted(features, key=lambda x: x.get("psi", 0), reverse=True):
        log(f"  {_status_icon(f['status'])} {f['feature']:<35} "
            f"PSI={f['psi']:.4f}  [{_psi_bar(f['psi'])}]  {f['status']}")
    if not features:
        log("  No feature drift data yet")

    # ── Prediction drift ───────────────────────────────────────────────────
    if drift_summary:
        section("PREDICTION DRIFT  (output score distribution per horizon)")
        pred_drift = drift_summary.get("prediction_drift", {})
        pred_overall = pred_drift.get("status", "NO_DATA")
        log(f"Overall    : {_status_icon(pred_overall)} {pred_overall}")
        for h in pred_drift.get("horizons", []):
            horizon  = h.get("horizon", "?")
            psi      = h.get("score_psi", 0.0)
            status   = h.get("score_status", "STABLE")
            high_pct = h.get("high_pct", 0.0)
            ref_high = h.get("ref_high_pct", 0.0)
            log(f"  {_status_icon(status)} {horizon}d  PSI={psi:.4f}  [{_psi_bar(psi)}]  "
                f"HIGH={high_pct:.1%} (ref {ref_high:.1%})")
        if not pred_drift.get("horizons"):
            log("  No prediction drift data yet")

        # ── Bias drift ─────────────────────────────────────────────────────
        section("BIAS DRIFT  (per-category HIGH% vs. training baseline)")
        bias_drift = drift_summary.get("bias_drift", {})
        bias_overall = bias_drift.get("status", "NO_DATA")
        log(f"Overall    : {_status_icon(bias_overall)} {bias_overall}")
        categories = bias_drift.get("categories", [])
        for c in sorted(categories, key=lambda x: x.get("deviation", 0), reverse=True):
            icon = "🚨" if c.get("alert") else "✅"
            log(f"  {icon} {c['category']:<20} "
                f"HIGH={c['high_pct']:.1%} (ref {c['ref_high_pct']:.1%})  "
                f"dev={c['deviation']:.1%}")
        if not categories:
            log("  No bias drift data yet")

    # ── Recommendation ─────────────────────────────────────────────────────
    section("RECOMMENDATION")
    action  = health.get("recommended_action", "none")
    reason  = health.get("reasoning", "")
    icon    = "🔴" if action != "none" else "🟢"
    log(f"Action     : {icon} {action.upper()}")
    log(f"Reasoning  : " + textwrap.fill(
        reason, width=58, subsequent_indent=" " * 14
    ))


# ─────────────────────────────────────────────────────────────────────────────
# ACTION + POLL
# ─────────────────────────────────────────────────────────────────────────────

def act(action: str, dry_run: bool) -> bool:
    """Trigger `action` unless dry_run. Returns True if triggered/would trigger."""
    if action not in AUTO_ACTIONS:
        log(f"Action '{action}' not in AUTO_ACTIONS — advisory only", "WARN")
        return False
    if dry_run:
        log(f"[DRY-RUN] Would trigger: {action}")
        return True
    try:
        result = trigger_action(action)
        log(f"Triggered  : {action} → {result.get('status', 'accepted')}")
        return True
    except requests.HTTPError as e:
        log(f"Action failed (HTTP {e.response.status_code}): {e.response.text[:200]}", "ERROR")
        return False
    except Exception as e:
        log(f"Action error: {e}", "ERROR")
        return False


def poll_training(timeout_s: int = 300):
    """Block until training completes or timeout. Called after triggering retrain."""
    log(f"Waiting for training to complete (timeout {timeout_s}s)…")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        d = get_training_status()
        if not d.get("running"):
            result = d.get("last_result") or {}
            if result.get("success"):
                log(f"Training complete — model {result.get('version', '?')}")
            else:
                log("Training finished with errors — check /train/status", "WARN")
            return
        time.sleep(15)
    log(f"Timed out after {timeout_s}s — training may still be running", "WARN")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def run_once(dry_run: bool, wait: bool) -> int:
    """Single monitoring cycle. Returns 0 if healthy, 1 if action was needed."""
    health        = get_health()
    drift_summary = get_drift_summary()
    report(health, drift_summary)

    action = health.get("recommended_action", "none")
    if action == "none":
        log("No action required — system healthy")
        return 0

    triggered = act(action, dry_run)
    if triggered and action == "retrain" and wait and not dry_run:
        poll_training()
    return 1


def main():
    parser = argparse.ArgumentParser(
        description="Enterprise Asset Intelligence — ML health monitor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
            Examples:
              python monitor.py                        # single run, auto-act
              python monitor.py --dry-run              # report only
              python monitor.py --loop 3600            # run every hour
              python monitor.py --loop 21600 --wait    # every 6h, wait for retrain
              python monitor.py --json                 # raw JSON dump
        """),
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Report only — never trigger actions")
    parser.add_argument("--loop", type=int, metavar="SECONDS",
                        help="Run continuously every N seconds")
    parser.add_argument("--wait", action="store_true",
                        help="After triggering retrain, block until complete")
    parser.add_argument("--json", action="store_true",
                        help="Dump raw health JSON and exit (no actions)")
    args = parser.parse_args()

    if args.json:
        health = get_health()
        print(json.dumps(health, indent=2, default=str))
        return

    if args.loop:
        log(f"Loop mode — every {args.loop}s (Ctrl+C to stop)")
        while True:
            try:
                run_once(dry_run=args.dry_run, wait=args.wait)
            except KeyboardInterrupt:
                log("Stopped by user")
                sys.exit(0)
            except Exception as e:
                log(f"Unexpected error: {e}", "ERROR")
            log(f"Sleeping {args.loop}s…")
            time.sleep(args.loop)
    else:
        code = run_once(dry_run=args.dry_run, wait=args.wait)
        sys.exit(code)


if __name__ == "__main__":
    main()
