# Enterprise Asset Intelligence

Predictive maintenance and risk scoring platform for heavy equipment rental fleets. Combines a Node.js/React web app with a Python ML service to forecast equipment failures before they happen.

---

## What It Does

- **Risk prediction** — A trained Random Forest model scores every asset (LOW / MEDIUM / HIGH) based on age, usage hours, maintenance history, and rental frequency
- **GenAI recommendations** — Groq LLM turns raw risk scores into plain-English maintenance actions per asset
- **Fleet dashboard** — Real-time overview of fleet health, upcoming maintenance, and high-risk equipment
- **ML pipeline** — Feature engineering → snapshot labeling → model training → inference, fully automated
- **Admin controls** — Override predictions, log maintenance events, manage equipment/rentals/vendors/job sites

---

## Architecture

```
Browser
  │
  ▼
Nginx (port 80)
  ├── /          → React SPA (static files)
  └── /api/*     → proxy → Node.js (port 5000)
                              │
                              ├── MySQL (external)
                              └── /predict → FastAPI ML (port 8000)
                                              │
                                              ├── MySQL (read)
                                              └── Groq API
```

**Stack:**

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, Recharts |
| API Gateway | Node.js, Express, Drizzle ORM |
| ML Service | Python 3.11, FastAPI, scikit-learn, Groq |
| Database | MySQL 8 |
| Infrastructure | Docker, docker-compose |

---

## Prerequisites

- Docker Desktop 4.x+ (16 GB RAM recommended)
- A MySQL 8 database (local or hosted — PlanetScale, RDS, etc.)
- A [Groq API key](https://console.groq.com) (free tier is sufficient)

---

## Quickstart

### 1. Clone and configure

```bash
git clone <repo-url>
cd enterprise-asset-intelligence
cp .env.example .env
```

Open `.env` and fill in:

```env
DATABASE_URL=mysql://user:password@host:3306/enterprise_assets
DB_HOST=your-db-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=enterprise_assets
SESSION_SECRET=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>
GROQ_API_KEY=gsk_...
```

### 2. Run database migrations

```bash
npm install
npx drizzle-kit migrate
```

### 3. Train the ML model (first time only)

The model artifacts must exist before the ML service starts. Training takes ~2 minutes.

```bash
cd ml-service
pip install -r ../requirements.txt
python train_model.py
cd ..
```

Artifacts are written to `ml-service/registry/`. They persist across container rebuilds via a Docker volume mount — you do not need to retrain on every `docker-compose up`.

### 4. Start all services

```bash
docker-compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost |
| API | http://localhost:5000 |
| ML service | http://localhost:8000 |
| ML docs | http://localhost:8000/docs |

### 5. Seed initial data (optional)

```bash
npm run db:seed
```

---

## Project Structure

```
.
├── client/                   # React frontend
│   └── src/
│       ├── components/       # Shared UI components
│       ├── pages/            # Route-level pages
│       └── lib/              # API client, hooks, utils
│
├── server/                   # Node.js API gateway
│   ├── routes.ts             # All Express route handlers
│   ├── storage.ts            # Database access layer
│   ├── db.ts                 # Drizzle client
│   └── services/
│       ├── predictive-maintenance.ts
│       ├── feature-engineering.ts
│       └── risk-scoring.ts
│
├── ml-service/               # Python FastAPI ML service
│   ├── api/
│   │   ├── main.py           # FastAPI app + lifespan
│   │   └── schemas/
│   │       └── prediction.py # Pydantic request/response models
│   ├── engine/
│   │   ├── predictor.py      # Model loading + inference
│   │   └── genai_advisor.py  # Groq recommendation generation
│   ├── run.py                # Uvicorn entrypoint
│   ├── train_model.py        # Offline training script
│   └── registry/             # Trained model artifacts (git-ignored)
│       ├── model.pkl
│       └── metadata.json
│
├── shared/
│   ├── schema.ts             # Drizzle table definitions (source of truth)
│   └── routes.ts             # Shared API route/type definitions
│
├── infrastructure/
│   └── docker/
│       ├── Dockerfile.client
│       ├── Dockerfile.server
│       └── Dockerfile.ml-service
│
├── migrations/               # Drizzle-generated SQL migrations
├── docker-compose.yml
├── drizzle.config.ts
├── .env.example
└── requirements.txt          # Python dependencies
```

---

## ML Pipeline

The ML pipeline runs in four stages:

```
1. Snapshots    npm run ml:snapshots      Capture feature vectors for all assets
2. Label        npm run ml:label          Mark 30-day failure outcomes on snapshots
3. Train        python train_model.py     Fit Random Forest, write registry/
4. Predict      npm run ml:predict-all    Score all assets, write to DB
```

Stages 1–2 build up labeled training data over time. Run stages 3–4 periodically (e.g. monthly via cron) to keep the model fresh.

**Features used by the model:**

| Feature | Source |
|---|---|
| Equipment age (years) | `manufacture_year` |
| Total usage hours | `usage_hours` |
| Days since last service | `maintenance_events` |
| Maintenance events per year | `maintenance_events` |
| Rental count (12 months) | `rentals` |
| Category risk factor | Equipment category |

**Model performance (v1.2.0, n=2,847):**

| Class | Precision | Recall | F1 |
|---|---|---|---|
| HIGH | 0.82 | 0.88 | 0.85 |
| MEDIUM | 0.79 | 0.74 | 0.76 |
| LOW | 0.91 | 0.89 | 0.90 |
| **Overall accuracy** | | | **0.847** |

---

## API Reference

Full interactive docs available at **http://localhost:8000/docs** (FastAPI) when running.

### Key endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/equipment` | List all equipment |
| `GET` | `/api/equipment/:id/risk` | Get latest risk prediction for asset |
| `GET` | `/api/predictive-maintenance/fleet-risk` | Fleet-wide risk distribution |
| `GET` | `/api/predictive-maintenance/equipment-with-risk` | Equipment list with risk attached |
| `POST` | `/api/predictive-maintenance/predict-all` | Re-score entire fleet |
| `GET` | `/api/ml/model-metrics` | Model accuracy, confusion matrix, feature importance |
| `GET` | `/api/ml/pipeline-status` | Snapshot and prediction counts |
| `POST` | `/api/predictive-maintenance/generate-snapshots` | Capture today's feature snapshots |
| `POST` | `/api/predictive-maintenance/label-snapshots` | Label historical snapshots |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | MySQL DSN for Node.js / Drizzle |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | ✅ | Individual DB vars for Python ML service |
| `SESSION_SECRET` | ✅ | Express session signing key |
| `JWT_SECRET` | ✅ | JWT signing key |
| `GROQ_API_KEY` | ✅ | Groq API key for LLM recommendations |
| `GROQ_MODEL` | — | Groq model ID (default: `llama3-8b-8192`) |
| `MODEL_VERSION` | — | Model version tag (default: `v1`) |
| `LLM_PROVIDER` | — | LLM provider (default: `groq`) |

---

## Development (without Docker)

```bash
# Terminal 1 — Node API
npm install
npm run dev

# Terminal 2 — ML service
cd ml-service
pip install -r ../requirements.txt
python run.py

# Terminal 3 — Vite dev server
npm run client
```

The Vite dev server proxies `/api` to `localhost:5000` automatically via `vite.config.ts`.

---

## Deployment Notes

- **Model artifacts** (`ml-service/registry/`) are excluded from git. Train locally, then either copy the registry to your server or add a startup script that trains if no artifacts are found.
- **Database migrations** must be run before the first server start: `npx drizzle-kit migrate`.
- **Memory**: The ML service loads the model into RAM on startup. Allow at least 512 MB; 1 GB is recommended under load.
- The `docker-compose.yml` start order is enforced via healthchecks: MySQL must accept connections before Node starts, and the ML service must be healthy before Node starts.

---

## License

MIT