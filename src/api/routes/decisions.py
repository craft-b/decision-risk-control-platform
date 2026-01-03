from fastapi import APIRouter
from decision_engine.orchestrator import DecisionOrchestrator
from api.schemas.decision import DecisionRequest, DecisionResponse

router = APIRouter()
orchestrator = DecisionOrchestrator()

@router.post("/", response_model=DecisionResponse)
def evaluate_decision(request: DecisionRequest):
    return orchestrator.evaluate(request)
