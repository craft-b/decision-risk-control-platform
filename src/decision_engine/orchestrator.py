from decision_engine.rule_engine import RuleEngine
from decision_engine.ml_engine import MLEngine
from decision_engine.genai_advisor import GenAIAdvisor
from decision_engine.risk_scorer import RiskScorer

class DecisionOrchestrator:
    def __init__(self):
        self.rules = RuleEngine()
        self.ml = MLEngine()
        self.genai = GenAIAdvisor()
        self.risk = RiskScorer()

    def evaluate(self, request):
        rule_result = self.rules.evaluate(request.input_data)
        ml_result = self.ml.predict(request.input_data)

        risk_score = self.risk.score(rule_result, ml_result)

        explanation = self.genai.explain(
            input_data=request.input_data,
            rule_result=rule_result,
            ml_result=ml_result,
            risk_score=risk_score
        )

        return {
            "decision": rule_result["decision"],
            "risk_score": risk_score,
            "explanation": explanation
        }
