# Enterprise Asset Intelligence

## Stack
- Frontend: React/TypeScript, Vite, port 5173
- Backend: Node.js/Express, Drizzle ORM, MySQL, port 5000
- ML Service: FastAPI, scikit-learn, port 8000
- Branch: feat/ml-v1.6-improvements

## Dev Commands
- `npm run dev` — starts Node + Vite
- `uvicorn api.main:app --reload --port 8000` — starts ML service (run from ml-service/)
- venv is at `venv/Scripts/python.exe`

## Key Files
- server/routes.ts — all API routes
- ml-service/api/main.py — FastAPI routes
- ml-service/training/train_model_multihorizon.py — training pipeline
- shared/schema.ts — Drizzle schema (source of truth)

## Conventions
- Multi-horizon models only (v1.14+), no legacy single-horizon predictor
- eventSource field on all new maintenance events
- simulation cursor is at 2032-04-08