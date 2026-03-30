# ml-service/engine/model_registry.py
# Champion-challenger model registry.
#
# ── Design ────────────────────────────────────────────────────────────────────
# Production ML systems don't hot-swap models immediately after training.
# Instead:
#   1. Newly trained model enters as "challenger".
#   2. Challenger runs in shadow mode: it scores every batch but its results
#      are logged, not written to the database.
#   3. After an observation window (or manual review), an operator promotes
#      the challenger to champion via POST /models/promote.
#   4. The old champion is retired (archived, not deleted).
#
# This pattern prevents regressions: if the challenger has worse recall on
# real traffic than the holdout test set suggested, you catch it before it
# affects maintenance scheduling decisions.
#
# State is persisted in registry/model_registry.json.
# Thread-safe for single-process uvicorn (no multiprocessing guard needed here).
# ─────────────────────────────────────────────────────────────────────────────

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

REGISTRY_DIR = Path(__file__).parent.parent / "registry"
REGISTRY_FILE = REGISTRY_DIR / "model_registry.json"

HORIZONS = [10, 30, 60]


def _version_key(version: str) -> tuple:
    m = re.search(r"v(\d+)\.(\d+)", version)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _list_available_versions() -> list[str]:
    """Return all version strings that have all three horizon model files."""
    versions = set()
    for f in REGISTRY_DIR.glob("rf_10d_*.pkl"):
        m = re.search(r"rf_10d_(v\d+\.\d+)\.pkl", f.name)
        if not m:
            continue
        v = m.group(1)
        if all((REGISTRY_DIR / f"rf_{h}d_{v}.pkl").exists() for h in HORIZONS):
            versions.add(v)
    return sorted(versions, key=_version_key)


def _read() -> dict:
    if not REGISTRY_FILE.exists():
        return {"champion": None, "challenger": None, "retired": [], "history": []}
    with open(REGISTRY_FILE) as f:
        return json.load(f)


def _write(state: dict):
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    with open(REGISTRY_FILE, "w") as f:
        json.dump(state, f, indent=2)


def get_state() -> dict:
    """Return current champion/challenger state, auto-bootstrapping if needed."""
    state = _read()

    # Bootstrap: if no champion set yet, assign the newest available version
    if state["champion"] is None:
        available = _list_available_versions()
        if available:
            state["champion"] = available[-1]
            state["history"].append({
                "event":     "auto_bootstrap",
                "version":   available[-1],
                "role":      "champion",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            _write(state)

    return state


def register_new_version(version: str) -> dict:
    """
    Called by training pipeline after a successful train.
    If no champion exists, the new version becomes champion directly.
    Otherwise it becomes challenger, replacing any existing challenger.
    """
    state = get_state()

    if state["champion"] is None:
        state["champion"] = version
        role = "champion"
    else:
        # Retire old challenger if one exists
        if state["challenger"] and state["challenger"] != version:
            if state["challenger"] not in state["retired"]:
                state["retired"].append(state["challenger"])
        state["challenger"] = version
        role = "challenger"

    state["history"].append({
        "event":     "registered",
        "version":   version,
        "role":      role,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    _write(state)
    print(f"[REGISTRY] {version} registered as {role}")
    return {"version": version, "role": role}


def promote_challenger() -> dict:
    """
    Promote challenger to champion. Old champion moves to retired list.
    Raises ValueError if no challenger exists.
    """
    state = get_state()

    if not state["challenger"]:
        raise ValueError("No challenger to promote. Train a new model first.")

    old_champion = state["champion"]
    new_champion = state["challenger"]

    state["champion"] = new_champion
    state["challenger"] = None

    if old_champion and old_champion not in state["retired"]:
        state["retired"].append(old_champion)

    state["history"].append({
        "event":        "promoted",
        "new_champion": new_champion,
        "old_champion": old_champion,
        "timestamp":    datetime.now(timezone.utc).isoformat(),
    })
    _write(state)
    print(f"[REGISTRY] Promoted {new_champion} to champion (retired {old_champion})")
    return {
        "promoted":    new_champion,
        "retired":     old_champion,
        "new_champion": new_champion,
    }


def get_champion_version() -> Optional[str]:
    return get_state()["champion"]


def get_challenger_version() -> Optional[str]:
    return get_state()["challenger"]


def get_metrics_for_version(version: str) -> dict:
    """Load per-horizon metadata files for a given model version."""
    metrics = {}
    for h in HORIZONS:
        meta_path = REGISTRY_DIR / f"metadata_{h}d_{version}.json"
        if meta_path.exists():
            with open(meta_path) as f:
                metrics[f"{h}d"] = json.load(f)
    return metrics
