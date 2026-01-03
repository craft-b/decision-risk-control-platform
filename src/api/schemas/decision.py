from pydantic import BaseModel
from typing import Dict, Any

class DecisionRequest(BaseModel):
    input_data: Dict[str, Any]

class DecisionResponse(BaseModel):
    decision: str
    risk_score: float
    explanation: str
