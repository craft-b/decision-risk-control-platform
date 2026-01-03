from fastapi import FastAPI
from api.routes import decisions, health

app = FastAPI(title="Decision & Risk Control Platform")

app.include_router(health.router, prefix="/health")
app.include_router(decisions.router, prefix="/decisions")
