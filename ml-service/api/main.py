# ml-service/api/main.py
# FastAPI ML service — the Python "brain" of the system.
# Runs on port 8000, called by the Node.js server via HTTP.
# Auto-generated Swagger UI available at http://localhost:8000/docs

import os
import sys
import subprocess
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from api.schemas.prediction import (
    SnapshotInput,
    BatchInput,
    HealthResponse,
    RiskLevel,
)

from engine.genai_advisor import generate_recommendation, is_available, LLM_PROVIDER
from engine.predictor_multihorizon import MultiHorizonPredictor
from engine.projector import project as project_trajectory

# ─────────────────────────────────────────────────────────────────────────────
# STARTUP / SHUTDOWN
# ─────────────────────────────────────────────────────────────────────────────

mh_predictor: MultiHorizonPredictor = None  # type: ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mh_predictor
    print("[STARTUP] Loading ML artifacts...")
    try:
        mh_predictor = MultiHorizonPredictor()
        print(f"[STARTUP] Multi-horizon models ready — version {mh_predictor.version}")
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
        "Serves multi-horizon failure probability predictions from calibrated "
        "Random Forest models (10d, 30d, 60d), with forward trajectory projection "
        "and LLM-generated maintenance recommendations via Groq."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("CLIENT_URL", "http://localhost:5173"),
        "http://localhost:3000",
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
    """Service health check."""
    return HealthResponse(
        status="healthy",
        model_version=mh_predictor.version if mh_predictor else "not loaded",
        model_loaded=mh_predictor is not None,
        llm_provider=LLM_PROVIDER,
        llm_available=is_available(),
    )


@app.post("/predict/multi-horizon", tags=["Inference"])
async def predict_multi_horizon(snapshot: SnapshotInput):
    """
    Multi-horizon failure prediction for a single equipment snapshot.
    Returns separate calibrated risk assessments for 10d, 30d, and 60d windows.
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


@app.post("/predict/project", tags=["Inference"])
async def project_failure_trajectory(snapshot: SnapshotInput):
    """
    Forward projection — ages features analytically and returns a 60-day
    failure probability curve plus threshold crossing estimates.

    Assumes no maintenance occurs during the projection window (conservative).

    Returns:
    - curve: list of {day, 10d, 30d, 60d} probability points at 7-day intervals
    - threshold_crossings: first day each horizon crosses HIGH threshold (null if never)
    - days_until_high: earliest crossing across all horizons
    """
    if not mh_predictor:
        raise HTTPException(status_code=503, detail="Multi-horizon model not loaded")
    try:
        snapshot_dict = snapshot.model_dump()
        result = project_trajectory(snapshot_dict, mh_predictor)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Projection failed: {str(e)}")


@app.get("/models/multi-horizon/info", tags=["Model"])
async def multi_horizon_model_info():
    """Returns loaded model versions and performance metrics per horizon."""
    if not mh_predictor:
        raise HTTPException(status_code=503, detail="Multi-horizon model not loaded")
    return {
        "versions":   mh_predictor.versions,
        "horizons":   [10, 30, 60],
        "confidence": {
            "10d": "high (CV ROC-AUC 0.987)",
            "30d": "high (CV ROC-AUC 0.985)",
            "60d": "high (CV ROC-AUC 0.982)",
        },
        "thresholds": {
            "10d": {"HIGH": 0.60, "MEDIUM": 0.30},
            "30d": {"HIGH": 0.60, "MEDIUM": 0.30},
            "60d": {"HIGH": 0.60, "MEDIUM": 0.30},
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING
# ─────────────────────────────────────────────────────────────────────────────

_training_status: dict = {"running": False, "log": [], "last_result": None}


@app.post("/train", tags=["Training"])
async def trigger_training(background_tasks: BackgroundTasks):
    """
    Triggers a full model retrain using train_model_multihorizon.py.
    Runs in a thread executor (required on Windows).
    Poll GET /train/status for progress and results.
    """
    if _training_status["running"]:
        raise HTTPException(status_code=409, detail="Training already in progress")

    async def run_training():
        global _training_status, mh_predictor

        _training_status["running"] = True
        _training_status["log"] = ["[JOB] Starting training pipeline..."]
        _training_status["last_result"] = None

        script_path = (
            Path(__file__).parent.parent / "training" / "train_model_multihorizon.py"
        )

        # Prefer venv Python so all ml dependencies are available
        venv_python = (
            Path(__file__).parent.parent.parent / "venv" / "Scripts" / "python.exe"
        )
        python_exe = str(venv_python) if venv_python.exists() else sys.executable

        _training_status["log"].append(f"[JOB] Python  : {python_exe}")
        _training_status["log"].append(f"[JOB] Script  : {script_path}")
        _training_status["log"].append(f"[JOB] Exists  : {script_path.exists()}")

        def run_sync():
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            return subprocess.run(
                [python_exe, str(script_path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                cwd=str(script_path.parent.parent),
            )

        try:
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=1) as pool:
                result = await loop.run_in_executor(pool, run_sync)

            for line in result.stdout.splitlines():
                _training_status["log"].append(line)
            for line in result.stderr.splitlines():
                _training_status["log"].append(f"[ERR] {line}")

            if len(_training_status["log"]) > 300:
                _training_status["log"] = _training_status["log"][-300:]

            success = result.returncode == 0

            if success:
                try:
                    mh_predictor = MultiHorizonPredictor()
                    _training_status["log"].append(
                        f"[JOB] Models reloaded — version {mh_predictor.version}"
                    )
                except Exception as reload_err:
                    _training_status["log"].append(
                        f"[JOB] Warning: model reload failed: {reload_err}"
                    )

            _training_status["last_result"] = {
                "success": success,
                "return_code": result.returncode,
                "version": mh_predictor.version if success and mh_predictor else None,
            }
            _training_status["log"].append(
                f"[JOB] {'Complete' if success else 'FAILED'} "
                f"— exit code {result.returncode}"
            )

        except Exception as e:
            import traceback as tb_mod
            _training_status["log"].append(f"[JOB] FATAL: {str(e)}")
            _training_status["log"].append(f"[JOB] TRACEBACK: {tb_mod.format_exc()}")
            _training_status["last_result"] = {"success": False, "error": str(e)}

        finally:
            _training_status["running"] = False

    background_tasks.add_task(run_training)
    return {"message": "Training job started", "poll": "/train/status"}


@app.get("/train/status", tags=["Training"])
async def training_status():
    """Poll for training progress. Returns log lines and running state."""
    return {
        "running":     _training_status["running"],
        "log":         _training_status["log"],
        "last_result": _training_status["last_result"],
    }