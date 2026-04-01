# Enterprise Asset Intelligence

Predictive maintenance platform for heavy construction equipment rental fleets. A full-stack system that simulates fleet operations, engineers features from operational data, trains calibrated Random Forest models, and serves multi-horizon failure probability predictions across 10, 30, and 60-day windows — with cost-optimized intervention recommendations and a rental dispatch risk guard.

---

## What It Does

- **Multi-horizon failure prediction** — Three separate calibrated Random Forest models score every asset across 10d, 30d, and 60d windows (LOW / MEDIUM / HIGH) based on 31 engineered features
- **60-day trajectory projection** — Forward-projects failure probability curves by analytically aging features at 7-day steps, with HIGH-threshold crossing detection
- **Cost model** — Identifies the optimal PM intervention day by comparing expected failure cost against scheduled maintenance cost, surfaced per-asset in the UI
- **Rental dispatch guard** — Blocks or warns dispatchers when HIGH/MEDIUM risk equipment is selected for a new rental, with mandatory risk acknowledgement for HIGH-risk dispatches
- **Fleet simulation engine** — Discrete-event simulator advances a cursor date, generates sensor readings, fires maintenance events via a Weibull-inspired hazard function, and handles fleet renewal (retirement + replacement) automatically
- **ML pipeline** — Full automated pipeline: feature snapshot generation → failure labeling → model training → inference, all triggerable from the admin UI
- **MLflow experiment tracking** — Every training run logs hyperparameters, per-horizon metrics (ROC-AUC, PR-AUC, recall, F1), per-fold CV scores, model artifacts, and feature importance JSONs under the `equipment-failure-multihorizon` experiment
- **SHAP explainability** — `TreeExplainer` runs at inference time; top 5 features by |SHAP value| are returned with every prediction for per-asset attribution
- **Three-layer drift detection** — Data drift (PSI on monitored features), prediction drift (distribution shift in 30d output scores), and bias drift (disparity in HIGH-rate across equipment categories); all persisted to `drift_metrics` table; dashboard surfaces per-feature PSI with STABLE / WARNING / ALERT status
- **Champion-challenger model governance** — Newly trained models enter registry as challengers; shadow-score every batch alongside champion without persisting results; admin promotes challenger to champion via `POST /api/ml/models/promote` with zero downtime (in-memory hot-swap); full audit history in `model_registry.json`
- **Pre-training data quality gate** — 8-check validator (row count, label completeness, class balance, null rates, physical bounds, non-zero required features, temporal spread, duplicate snapshots) blocks training on FAIL, warns on marginal data, PASS/WARN/FAIL summary in training log
- **SMOTE oversampling** — Applied per-horizon on training fold minority class to address class imbalance before RF fitting; improves recall on failure class
- **Agent API** — Bearer-token authenticated endpoints (`GET /api/agent/model-health`, `POST /api/agent/actions`) for programmatic and LLM agent access; returns consolidated health snapshot with machine-readable `recommended_action`
- **Automated monitoring** — `monitor.py` cron script polls model health, logs three-layer drift per feature, auto-triggers retraining or reference recomputation based on drift state, and fires Slack webhook alerts when action is needed or any drift layer reaches WARNING/ALERT; supports `--loop` mode for continuous polling
- **GenAI recommendations** — Groq LLM turns risk scores into plain-English maintenance actions per asset
- **ML metrics dashboard** — Live feature importance, confusion matrix, per-class precision/recall/F1, prediction distribution over time, hyperparameter display, drift monitor card, champion-challenger comparison table, and data quality report card

---

## Architecture

```
Browser
  │
  ▼
React SPA (Vite, port 5173)
  │
  └── /api/*  →  Node.js / Express (port 5000)
                    │
                    ├── MySQL 8
                    │
                    └── http://localhost:8000  →  FastAPI ML Service (port 8000)
                                                    │
                                                    ├── MySQL 8 (read, training)
                                                    ├── Groq API (recommendations)
                                                    └── ml-service/registry/ (model artifacts)
```

**Stack:**

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, shadcn/ui, Recharts, TanStack Query |
| API | Node.js, Express, Drizzle ORM |
| ML Service | Python 3.12, FastAPI, scikit-learn, pandas, SQLAlchemy |
| Database | MySQL 8 |
| Experiment Tracking | MLflow 2.16 |
| Explainability | SHAP 0.51 (TreeExplainer) |
| Drift Detection | PSI (data), output distribution (prediction), category disparity (bias) |
| Model Governance | Champion-challenger registry, shadow scoring, zero-downtime promotion |
| Data Quality | 8-check pre-training gate (row count, balance, nulls, bounds, temporal spread) |
| CI | GitHub Actions — lint (ruff), smoke-test, typecheck (tsc) |
| LLM | Groq (llama-3.1-8b-instant) |

---

## ML Models — v1.14

Three separate binary classifiers, one per prediction horizon. Each is a calibrated Random Forest trained on a temporal holdout split with TimeSeriesSplit cross-validation.

**Training data:** 22,025 labeled snapshots · 31 features · 2024–2032 simulation timeline

**Model performance:**

| Horizon | CV ROC-AUC | Holdout ROC-AUC | PR-AUC | Recall (failure) | Calibration |
|---|---|---|---|---|---|
| 10d | 0.9871 ± 0.0050 | 0.9672 | 0.9383 | 92.5% | Sigmoid |
| 30d | 0.9853 ± 0.0090 | 0.9297 | 0.9210 | 81.7% | Isotonic |
| 60d | 0.9815 ± 0.0147 | 0.8821 | 0.8826 | 71.0% | Isotonic |

**Top features (consistent across all horizons):**

| Rank | Feature | Importance |
|---|---|---|
| 1 | `asset_age_years` | ~20–22% |
| 2 | `log_maintenance_cost_180d` | ~13–17% |
| 3 | `wear_rate_velocity` | ~11–14% |
| 4 | `log_total_hours_lifetime` | ~12–15% |
| 5 | `log_mean_time_between_failures` | ~12–16% |

**Why holdout AUC drops across horizons:** The 60d holdout set has a 37% positive rate vs 25% in dev — the aging fleet distribution shifts significantly over time. CV ROC-AUC is the more representative performance estimate for deployment.

---

## Feature Engineering

31 features computed per asset per snapshot date from raw operational tables:

```
asset_age_years, rental_days_30d, rental_days_90d, avg_rental_duration,
maintenance_events_90d, days_since_last_maintenance, vendor_reliability_score,
jobsite_risk_score, usage_intensity, usage_trend, utilization_vs_expected,
wear_rate, aging_factor, maint_overdue, mechanical_wear_score, abuse_score,
neglect_score, wear_rate_velocity, maint_frequency_trend, cost_trend,
hours_velocity, neglect_acceleration, sensor_degradation_rate, category_encoded,
log_total_hours_lifetime, log_hours_used_30d, log_hours_used_90d,
log_maintenance_cost_180d, log_cost_per_event, log_maint_burden,
log_mean_time_between_failures
```

Seven skewed features are log-transformed at training and inference time. Derived columns (aging_factor, wear_rate, mechanical_wear_score, etc.) are recomputed fresh at inference rather than stored — avoids staleness from schema drift.

---

## ML Pipeline

All four stages are triggerable from the admin panel in the UI (ADMINISTRATOR role required):

```
1. Generate Snapshots   →  Backfills feature vectors across full simulation timeline (7-day intervals)
2. Label Snapshots      →  Marks 10d/30d/60d failure outcomes on each snapshot
3. Retrain Models       →  Trains v1.14+ models, hot-swaps on completion (~3 min)
4. Run Predictions      →  Scores all active fleet units with latest models
```

Training uses TimeSeriesSplit CV (5 folds, gap = horizon days) to prevent label leakage. Version is auto-incremented from the last DB record. Artifacts written to `ml-service/registry/`.

---

## Simulation Engine

A discrete-event simulator advances a cursor date day by day:

- **Sensor data** generated per equipment per day (engine temp, RPM, vibration, hydraulic pressure, etc.)
- **Maintenance events** fired probabilistically via a Weibull-inspired hazard function combining age hazard + hours hazard + neglect hazard
- **Fleet renewal** — equipment retired at age >10y OR (age >8y AND hours >8,000), replaced with `EQ-R{id}-{year}` pattern
- **Simulation cursor** — currently at 2032-04-08, 60 days run

---

## Project Structure

```
.
├── client/                        # React frontend (Vite)
│   └── src/
│       ├── components/            # Shared UI components
│       ├── hooks/
│       │   └── use-predictive-maintenance.ts  # TanStack Query hooks (predictions, drift, training)
│       ├── lib/
│       │   └── cost-model.ts      # Optimal PM intervention calculator
│       └── pages/
│           ├── predictive-maintenance-dashboard.tsx  # Fleet prediction UI + SHAP modal
│           └── ml-dashboard.tsx                      # Model metrics, drift monitor, MLflow stats
│
├── server/                        # Node.js API gateway
│   ├── routes.ts                  # All Express routes incl. agent API + drift proxy
│   └── services/
│       ├── feature-engineering-enhanced.ts  # Full 31-feature computation + velocity features
│       └── feature-engineering.ts           # Base snapshot persistence
│
├── ml-service/                    # Python FastAPI ML service
│   ├── api/
│   │   └── main.py                # FastAPI app — inference, drift, training endpoints
│   ├── engine/
│   │   ├── predictor_multihorizon.py  # Multi-horizon inference + SHAP attribution
│   │   ├── model_registry.py          # Champion-challenger registry — JSON-backed, numeric sort
│   │   ├── data_quality.py            # 8-check pre-training data quality gate
│   │   ├── drift_detector.py          # Three-layer drift detection (data/prediction/bias)
│   │   ├── projector.py               # 60-day forward projection engine
│   │   └── genai_advisor.py           # Groq recommendation generation
│   ├── training/
│   │   └── train_model_multihorizon.py  # Training pipeline — TimeSeriesSplit CV + MLflow logging + DQ gate
│   ├── tests/
│   │   ├── test_ml_engine.py          # 26 tests — inference, monotonicity, risk ordering, batch, schema
│   │   ├── test_train_smoke.py        # 25 tests — full training pipeline on synthetic data
│   │   ├── test_data_quality.py       # 47 tests — all 8 DQ checks + report structure
│   │   └── test_model_registry.py     # 27 tests — champion/challenger/promote/metrics (in-memory)
│   └── registry/                  # Versioned model artifacts
│       ├── rf_{h}d_v1.14.pkl
│       ├── clip_thresholds_v1.14.json
│       ├── feature_cols_v1.14.json
│       ├── metadata_{h}d_v1.14.json
│       └── feature_importance_{h}d_v1.14.json
│
├── monitor.py                     # Local cron script — polls agent API, auto-triggers retrain; --loop mode
├── .github/workflows/ml-ci.yml   # CI: lint (ruff), smoke-test, typecheck (tsc)
└── shared/
    ├── schema.ts                  # Drizzle table definitions (source of truth)
    └── routes.ts                  # Shared API route/type definitions
```

---

## API Reference

Full interactive docs at **http://localhost:8000/docs** when running.

### Inference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/risk-score/multi-horizon/batch` | Score fleet with 10d/30d/60d models |
| `GET` | `/api/risk-score/multi-horizon/latest` | Latest stored multi-horizon predictions |
| `GET` | `/api/equipment/:id/projection` | 60-day failure trajectory curve |

### Pipeline

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/predictive-maintenance/generate-snapshots` | Backfill feature snapshots |
| `POST` | `/api/predictive-maintenance/label-snapshots` | Label failure outcomes |
| `POST` | `/api/ml/train` | Trigger model retrain (admin only) |
| `GET` | `/api/ml/train/status` | Poll training progress + log |
| `GET` | `/api/ml/pipeline-status` | Snapshot counts, model version, readiness |
| `GET` | `/api/ml/model-metrics` | Accuracy, confusion matrix, feature importance |

### Drift Monitoring

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ml/drift/latest` | Most recent PSI per monitored feature |
| `POST` | `/api/ml/drift/compute-reference` | Recompute reference baseline from training data |

### Model Governance

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/ml/models/registry` | Champion, challenger, retired versions + audit history |
| `GET` | `/api/ml/models/compare` | Per-horizon metric comparison (champion vs challenger) |
| `POST` | `/api/ml/models/promote` | Promote challenger to champion (admin only) |
| `GET` | `/api/ml/data-quality/report` | Latest pre-training data quality report (8 checks) |

### Agent API

Authenticated with `Authorization: Bearer <AGENT_API_KEY>`. Designed for programmatic access by scripts or LLM agents.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agent/model-health` | Consolidated model + drift + pipeline health with `recommended_action` |
| `POST` | `/api/agent/actions` | Trigger `retrain` or `compute_drift_reference` |

### Simulation

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/simulate/state` | Current cursor date + days run |
| `POST` | `/api/simulate/day` | Advance simulation N days (max 30) |

---

## Quickstart

### 1. Clone and configure

```bash
git clone <repo-url>
cd enterprise-asset-intelligence
cp .env.example .env
```

Fill in `.env`:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=asset_inventory
SESSION_SECRET=<openssl rand -hex 32>
GROQ_API_KEY=gsk_...
AGENT_API_KEY=<python -c "import secrets; print(secrets.token_hex(32))">
```

### 2. Install and migrate

```bash
npm install
npx drizzle-kit migrate
```

### 3. Start services

```bash
# Terminal 1 — Node API + Vite dev server
npm run dev

# Terminal 2 — ML service
cd ml-service
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
```

### 4. First-time setup (onboarding screen)

On first login, the app automatically redirects to `/setup`. Choose one of two paths:

**Load Demo Data** — recommended for evaluation and interviews. Runs the full seed pipeline in the background (~60–90 seconds) and streams live progress. Seeds:
- 10 heavy equipment units across four categories
- 90 days of sensor readings per asset
- Maintenance history with realistic failure events
- Trained multi-horizon ML model (10d / 30d / 60d)
- SHAP attribution, MLflow run, drift reference baseline

**Start Fresh** — skip demo data and build the dataset manually with real equipment and operational records. The dashboard surfaces guided empty states that walk you through adding equipment, logging maintenance, running the ML pipeline, and generating predictions in the right order.

> The onboarding screen re-appears any time the system is reset via `POST /api/admin/reset` (ADMINISTRATOR role only).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | ✅ | MySQL connection |
| `SESSION_SECRET` | ✅ | Express session signing key |
| `GROQ_API_KEY` | ✅ | Groq API key for LLM recommendations |
| `AGENT_API_KEY` | ✅ | Bearer token for agent API (`/api/agent/*`). Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `GROQ_MODEL` | — | Groq model ID (default: `llama-3.1-8b-instant`) |
| `LLM_PROVIDER` | — | `groq` or `ollama` (default: `groq`) |
| `MLFLOW_TRACKING_URI` | — | MLflow server URI. If unset, MLflow logging is skipped (safe no-op). |
| `SLACK_WEBHOOK_URL` | — | Incoming webhook URL for `monitor.py` alerts. If unset, Slack notifications are silently skipped. |
| `PYTHONIOENCODING` | — | Set to `utf-8` on Windows to avoid codec errors |

---

## Key Design Decisions

**Why three separate models instead of one multi-output model?**
Each horizon has a different positive rate (10d: 19.8%, 30d: 24.0%, 60d: 27.6%) and different optimal calibration (sigmoid for 10d, isotonic for 30d/60d). Separate models allow horizon-specific tuning and independent deployment.

**Why TimeSeriesSplit instead of random CV?**
Random CV leaks future data into training folds on temporal datasets. TimeSeriesSplit ensures each fold trains on past data only, which correctly simulates the deployment scenario.

**Why recompute derived features at inference instead of storing them?**
Storing derived columns (aging_factor, wear_rate, mechanical_wear_score) creates staleness risk — if the computation logic changes, stored values become inconsistent with what the model was trained on. Recomputing from raw inputs at inference keeps the feature pipeline as the single source of truth.

**Why a forward projection engine?**
Point-in-time predictions answer "what is the risk today?" The projection engine answers "when will this asset cross the HIGH threshold?" — which is the operationally useful question for scheduling maintenance windows.

---

## License

MIT