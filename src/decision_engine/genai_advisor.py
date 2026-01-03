class GenAIAdvisor:
    def explain(self, input_data, rule_result, ml_result, risk_score):
        return (
            f"Decision based on rules ({rule_result['decision']}) "
            f"and ML score ({ml_result['score']}) "
            f"with overall risk {risk_score}"
        )
