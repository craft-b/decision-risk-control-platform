class RuleEngine:
    def evaluate(self, data):
        if data.get("value", 0) > 100:
            return {"decision": "REJECT", "confidence": 0.9}
        return {"decision": "APPROVE", "confidence": 0.7}
