#!/usr/bin/env python
# ml-service/run.py
# Start the FastAPI ML service.
# Usage: python run.py
# The service runs on port 8000 by default (set ML_SERVICE_PORT to override).

import os
import sys
from pathlib import Path

# Ensure ml-service root is on the Python path
# so `from api.xxx` and `from engine.xxx` imports resolve correctly
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

# Load .env from project root (one level up from ml-service/)
from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("ML_SERVICE_PORT", "8000"))
    reload = os.getenv("NODE_ENV", "development") == "development"

    print(f"[ML SERVICE] Starting on port {port} (reload={'on' if reload else 'off'})")

    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=port,
        reload=reload,
        reload_dirs=[str(ROOT)] if reload else None,
        log_level="info",
    )