# ml-service/tests/test_model_registry.py
# Unit tests for the champion-challenger model registry.
# Fully in-memory via tmp_path — does not touch the real registry directory.
# Run: python -m pytest ml-service/tests/test_model_registry.py -v

import json
import sys
import pytest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import engine.model_registry as mr


# ─────────────────────────────────────────────────────────────────────────────
# FIXTURES — redirect registry to a temp directory per test
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def isolated_registry(tmp_path, monkeypatch):
    """
    Redirect REGISTRY_DIR and REGISTRY_FILE to a fresh temp dir for every test.
    Creates fake model PKL stubs so _list_available_versions() finds them.
    """
    monkeypatch.setattr(mr, "REGISTRY_DIR",  tmp_path)
    monkeypatch.setattr(mr, "REGISTRY_FILE", tmp_path / "model_registry.json")
    yield tmp_path


def _stub_version(registry_dir: Path, version: str):
    """Create empty .pkl stubs so the version appears as available."""
    for h in [10, 30, 60]:
        (registry_dir / f"rf_{h}d_{version}.pkl").write_bytes(b"stub")


# ─────────────────────────────────────────────────────────────────────────────
# get_state
# ─────────────────────────────────────────────────────────────────────────────

class TestGetState:
    def test_empty_registry_returns_defaults(self, isolated_registry):
        state = mr.get_state()
        assert "champion" in state
        assert "challenger" in state
        assert "retired" in state
        assert "history" in state

    def test_auto_bootstrap_on_available_version(self, isolated_registry):
        _stub_version(isolated_registry, "v1.0")
        state = mr.get_state()
        assert state["champion"] == "v1.0"

    def test_no_bootstrap_without_artifacts(self, isolated_registry):
        state = mr.get_state()
        assert state["champion"] is None

    def test_bootstrap_picks_latest_version(self, isolated_registry):
        _stub_version(isolated_registry, "v1.0")
        _stub_version(isolated_registry, "v1.5")
        _stub_version(isolated_registry, "v1.12")
        state = mr.get_state()
        assert state["champion"] == "v1.12"

    def test_bootstrap_uses_numeric_sort_not_lexical(self, isolated_registry):
        # v1.9 < v1.12 numerically but v1.9 > v1.12 lexically
        _stub_version(isolated_registry, "v1.9")
        _stub_version(isolated_registry, "v1.12")
        state = mr.get_state()
        assert state["champion"] == "v1.12", (
            "Version sorting should be numeric (v1.12 > v1.9), not lexical"
        )

    def test_state_persisted_after_bootstrap(self, isolated_registry):
        _stub_version(isolated_registry, "v1.0")
        mr.get_state()
        # Read raw file — bootstrap should have written it
        raw = json.loads((isolated_registry / "model_registry.json").read_text())
        assert raw["champion"] == "v1.0"


# ─────────────────────────────────────────────────────────────────────────────
# register_new_version
# ─────────────────────────────────────────────────────────────────────────────

class TestRegisterNewVersion:
    def test_first_version_becomes_champion(self, isolated_registry):
        result = mr.register_new_version("v1.0")
        assert result["role"] == "champion"
        assert mr.get_champion_version() == "v1.0"

    def test_second_version_becomes_challenger(self, isolated_registry):
        mr.register_new_version("v1.0")
        result = mr.register_new_version("v1.1")
        assert result["role"] == "challenger"
        assert mr.get_challenger_version() == "v1.1"
        assert mr.get_champion_version() == "v1.0"  # champion unchanged

    def test_new_challenger_replaces_old_challenger(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.register_new_version("v1.2")
        state = mr.get_state()
        assert state["challenger"] == "v1.2"
        assert "v1.1" in state["retired"]

    def test_history_recorded(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        state = mr.get_state()
        events = [e["event"] for e in state["history"]]
        assert "registered" in events

    def test_history_contains_version(self, isolated_registry):
        mr.register_new_version("v2.0")
        state = mr.get_state()
        versions_in_history = [e.get("version") for e in state["history"]]
        assert "v2.0" in versions_in_history

    def test_returns_version_and_role(self, isolated_registry):
        result = mr.register_new_version("v3.0")
        assert result["version"] == "v3.0"
        assert result["role"] in {"champion", "challenger"}


# ─────────────────────────────────────────────────────────────────────────────
# promote_challenger
# ─────────────────────────────────────────────────────────────────────────────

class TestPromoteChallenger:
    def test_promote_makes_challenger_champion(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.promote_challenger()
        assert mr.get_champion_version() == "v1.1"

    def test_promote_clears_challenger(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.promote_challenger()
        assert mr.get_challenger_version() is None

    def test_promote_retires_old_champion(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.promote_challenger()
        state = mr.get_state()
        assert "v1.0" in state["retired"]

    def test_promote_raises_without_challenger(self, isolated_registry):
        mr.register_new_version("v1.0")
        with pytest.raises(ValueError, match="No challenger"):
            mr.promote_challenger()

    def test_promote_records_history(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.promote_challenger()
        state = mr.get_state()
        events = [e["event"] for e in state["history"]]
        assert "promoted" in events

    def test_promote_history_contains_versions(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        mr.promote_challenger()
        state = mr.get_state()
        promo = next(e for e in state["history"] if e["event"] == "promoted")
        assert promo["new_champion"] == "v1.1"
        assert promo["old_champion"] == "v1.0"

    def test_double_promote_after_two_trains(self, isolated_registry):
        mr.register_new_version("v1.0")  # champion
        mr.register_new_version("v1.1")  # challenger
        mr.promote_challenger()           # v1.1 → champion, v1.0 → retired
        mr.register_new_version("v1.2")  # new challenger
        mr.promote_challenger()           # v1.2 → champion, v1.1 → retired
        state = mr.get_state()
        assert state["champion"] == "v1.2"
        assert state["challenger"] is None
        assert "v1.0" in state["retired"]
        assert "v1.1" in state["retired"]

    def test_returns_result_dict(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        result = mr.promote_challenger()
        assert "promoted" in result
        assert "retired" in result
        assert "new_champion" in result


# ─────────────────────────────────────────────────────────────────────────────
# get_champion_version / get_challenger_version
# ─────────────────────────────────────────────────────────────────────────────

class TestConvenienceFunctions:
    def test_get_champion_none_initially(self, isolated_registry):
        assert mr.get_champion_version() is None

    def test_get_challenger_none_initially(self, isolated_registry):
        assert mr.get_challenger_version() is None

    def test_get_champion_after_register(self, isolated_registry):
        mr.register_new_version("v1.0")
        assert mr.get_champion_version() == "v1.0"

    def test_get_challenger_after_second_register(self, isolated_registry):
        mr.register_new_version("v1.0")
        mr.register_new_version("v1.1")
        assert mr.get_challenger_version() == "v1.1"


# ─────────────────────────────────────────────────────────────────────────────
# get_metrics_for_version
# ─────────────────────────────────────────────────────────────────────────────

class TestGetMetrics:
    def test_returns_empty_when_no_metadata(self, isolated_registry):
        metrics = mr.get_metrics_for_version("v1.0")
        assert metrics == {}

    def test_returns_metrics_when_metadata_exists(self, isolated_registry):
        # Write fake metadata files
        for h in [10, 30, 60]:
            meta = {
                "version": "v1.0",
                "horizon_days": h,
                "roc_auc": 0.95,
                "pr_auc": 0.88,
                "per_class": {
                    "failure": {"recall": 0.82, "precision": 0.79, "f1": 0.80, "support": 50}
                },
                "samples_test": 250,
                "positive_rate": 0.20,
                "trained_at": "2026-01-01T00:00:00",
            }
            (isolated_registry / f"metadata_{h}d_v1.0.json").write_text(
                json.dumps(meta)
            )
        metrics = mr.get_metrics_for_version("v1.0")
        assert "10d" in metrics
        assert "30d" in metrics
        assert "60d" in metrics
        assert metrics["30d"]["roc_auc"] == 0.95

    def test_partial_metadata_handled(self, isolated_registry):
        # Only 30d metadata exists
        meta = {"version": "v1.0", "roc_auc": 0.90}
        (isolated_registry / "metadata_30d_v1.0.json").write_text(json.dumps(meta))
        metrics = mr.get_metrics_for_version("v1.0")
        assert "30d" in metrics
        assert "10d" not in metrics
