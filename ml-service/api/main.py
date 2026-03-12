# ml-service/api/main.py
# FastAPI ML service — the Python "brain" of the system.
# Runs on port 8000, called by the Node.js server via HTTP.
# Auto-generated Swagger UI available at http://localhost:8000/docs

import os
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from api.schemas.prediction import (
    SnapshotInput,
    PredictionOutput,
    BatchInput,
    BatchOutput,
    HealthResponse,
    ModelInfoResponse,
    RiskLevel,
)
from engine.predictor import EquipmentPredictor
from engine.genai_advisor import generate_recommendation, is_available, LLM_PROVIDER
from engine.predictor_multihorizon import MultiHorizonPredictor

# ─────────────────────────────────────────────────────────────────────────────
# STARTUP / SHUTDOWN
# Model loads once here — not on every request
# ─────────────────────────────────────────────────────────────────────────────

predictor: EquipmentPredictor = None  # type: ignore
mh_predictor: MultiHorizonPredictor = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor, mh_predictor 
    print("[STARTUP] Loading ML artifacts...")
    try:
        predictor = EquipmentPredictor()
        mh_predictor = MultiHorizonPredictor()
        print(f"[STARTUP] Multi-horizon models ready — version {mh_predictor.version}")
        print(f"[STARTUP] Model ready — version {predictor.version}")
    except Exception as e:
        print(f"[STARTUP] FATAL: Could not load model: {e}")
        raise
    yield
    print("[SHUTDOWN] ML service stopping")


# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Enterprise Asset Intelligence — ML Service",
    description=(
        "Predictive maintenance API for construction equipment rental. "
        "Serves failure probability predictions from a calibrated Random Forest model, "
        "with LLM-generated maintenance recommendations via Groq/Ollama."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",        # Swagger UI
    redoc_url="/redoc",      # ReDoc alternative
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("CLIENT_URL", "http://localhost:5173"),
        "http://localhost:3000",   # Node server
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Service health check. Called by docker-compose healthcheck and Node server."""
    return HealthResponse(
        status="healthy",
        model_version=predictor.version if predictor else "not loaded",
        model_loaded=predictor is not None,
        llm_provider=LLM_PROVIDER,
        llm_available=is_available(),
    )


@app.get("/model/info", response_model=ModelInfoResponse, tags=["Model"])
async def model_info():
    """
    Returns model metadata — accuracy, ROC-AUC, top features, training date.
    Displayed on the ML dashboard in the React frontend.
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Model not loaded")

    meta = predictor.metadata
    return ModelInfoResponse(
        version=predictor.version,
        algorithm=meta.get("algorithm", "Random Forest (calibrated, isotonic)"),
        trained_at=meta.get("trained_at", predictor.trained_at),
        dataset_size=meta.get("dataset_size", 0),
        accuracy=meta.get("accuracy", 0.0),
        roc_auc=meta.get("roc_auc", 0.0),
        feature_count=len(predictor.expected_features),
        top_features=meta.get("top_features", list(predictor.feature_importance.keys())[:10]),
    )


@app.post("/predict", response_model=PredictionOutput, tags=["Inference"])
async def predict(snapshot: SnapshotInput):
    """
    Run failure prediction for a single equipment snapshot.

    Returns:
    - failure_probability: calibrated P(failure within 30 days)
    - risk_level: LOW / MEDIUM / HIGH
    - top_risk_drivers: human-readable explanation
    - recommendation: LLM-generated maintenance action (if LLM available)
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        snapshot_dict = snapshot.model_dump()
        result = predictor.predict(snapshot_dict)

        # Enrich with LLM recommendation
        # generate_recommendation handles all failures gracefully — never raises
        result["recommendation"] = generate_recommendation(snapshot_dict, result)

        return PredictionOutput(**result)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/predict/batch", response_model=BatchOutput, tags=["Inference"])
async def predict_batch(batch: BatchInput):
    """
    Run failure prediction for multiple equipment snapshots.
    Used by the Node.js ml-pipeline-orchestrator for scheduled batch scoring.
    """
    if not predictor:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if len(batch.snapshots) > 500:
        raise HTTPException(status_code=400, detail="Batch size limit is 500 snapshots")

    try:
        predictions = []
        for snapshot in batch.snapshots:
            snapshot_dict = snapshot.model_dump()
            result = predictor.predict(snapshot_dict)

            # Only generate LLM recommendations for HIGH risk in batch mode
            # to stay within Groq free tier rate limits
            if result["risk_level"] == "HIGH":
                result["recommendation"] = generate_recommendation(snapshot_dict, result)
            else:
                result["recommendation"] = None

            predictions.append(PredictionOutput(**result))

        return BatchOutput(
            predictions=predictions,
            total=len(predictions),
            high_risk_count=sum(1 for p in predictions if p.risk_level == RiskLevel.HIGH),
            medium_risk_count=sum(1 for p in predictions if p.risk_level == RiskLevel.MEDIUM),
            low_risk_count=sum(1 for p in predictions if p.risk_level == RiskLevel.LOW),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch prediction failed: {str(e)}")


@app.get("/model/features", tags=["Model"])
async def get_features():
    """Returns the exact feature list the model expects — useful for debugging mismatches."""
    if not predictor:
        raise HTTPException(status_code=503, detail="Model not loaded")

    return {
        "feature_count": len(predictor.expected_features),
        "features": predictor.expected_features,
        "feature_importance": predictor.feature_importance,
    }

@app.post("/predict/multi-horizon", tags=["Inference"])
async def predict_multi_horizon(snapshot: SnapshotInput):
    """
    Multi-horizon failure prediction for a single equipment snapshot.
    Returns separate risk assessments for 10d, 30d, and 60d windows.
    """
    if not mh_predictor:
        raise HTTPException(status_code=503, detail="Multi-horizon model not loaded")
    try:
        snapshot_dict = snapshot.model_dump()
        result = mh_predictor.predict_multi_horizon(snapshot_dict)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Multi-horizon prediction failed: {str(e)}")


@app.post("/predict/multi-horizon/batch", tags=["Inference"])
async def predict_multi_horizon_batch(batch: BatchInput):
    """
    Batch multi-horizon predictions for multiple equipment items.
    """
    if not mh_predictor:
        raise HTTPException(status_code=503, detail="Multi-horizon model not loaded")
    if len(batch.snapshots) > 500:
        raise HTTPException(status_code=400, detail="Batch size limit is 500 snapshots")
    try:
        snapshots = [s.model_dump() for s in batch.snapshots]
        results = mh_predictor.predict_multi_horizon_batch(snapshots)
        return {"predictions": results, "total": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch prediction failed: {str(e)}")


@app.get("/models/multi-horizon/info", tags=["Model"])
async def multi_horizon_model_info():
    """Returns loaded model versions and confidence levels per horizon."""
    if not mh_predictor:
        raise HTTPException(status_code=503, detail="Multi-horizon model not loaded")
    return {
        "versions":   mh_predictor.versions,
        "horizons":   [10, 30, 60],
        "confidence": {
            "10d": "moderate (ROC-AUC 0.72)",
            "30d": "high (ROC-AUC 0.96)",
            "60d": "very high (ROC-AUC 0.997)",
        },
        "thresholds": {
            "10d": {"HIGH": 0.60, "MEDIUM": 0.30},
            "30d": {"HIGH": 0.65, "MEDIUM": 0.35},
            "60d": {"HIGH": 0.70, "MEDIUM": 0.40},
        },
    }