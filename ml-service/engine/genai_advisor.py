# ml-service/engine/genai_advisor.py
# LLM-powered maintenance recommendation engine.
# Takes structured prediction output + feature snapshot → actionable prose.
# Designed with swappable backends: groq | ollama | none
# Provider is set via LLM_PROVIDER env var — no code changes needed to switch.

import os
from typing import Optional


LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")


# ─────────────────────────────────────────────────────────────────────────────
# PROMPT BUILDER
# Structured context → prompt. Keeping this separate from the API call makes
# it easy to test and tune without touching provider logic.
# ─────────────────────────────────────────────────────────────────────────────

def _build_prompt(snapshot: dict, prediction: dict) -> str:
    risk_level = prediction["risk_level"]
    prob = prediction["failure_probability"]
    drivers = prediction.get("top_risk_drivers", [])
    category = snapshot.get("category", "Equipment")
    age = snapshot.get("asset_age_years", 0)
    hours = snapshot.get("total_hours_lifetime", 0)
    days_since_maint = snapshot.get("days_since_last_maintenance", 999)
    wear = snapshot.get("mechanical_wear_score", 0)
    abuse = snapshot.get("abuse_score", 0)
    neglect = snapshot.get("neglect_score", 0)
    intensity = snapshot.get("usage_intensity", 0)
    maint_cost = snapshot.get("maintenance_cost_180d", 0)

    drivers_text = "\n".join(f"- {d}" for d in drivers) if drivers else "- No specific drivers flagged"

    return f"""You are a senior maintenance engineer advising a construction equipment rental company.

EQUIPMENT PROFILE:
- Type: {category}
- Age: {age:.1f} years
- Lifetime hours: {int(hours):,} hrs
- Days since last maintenance: {int(days_since_maint)} days
- Usage intensity: {intensity:.1f} hrs/day

RISK ASSESSMENT:
- Risk level: {risk_level}
- Failure probability (30-day window): {prob*100:.1f}%
- Mechanical wear score: {wear:.1f}/10
- Operational stress score: {abuse:.1f}/10
- Maintenance neglect score: {neglect:.1f}/10
- Maintenance spend (last 180 days): ${maint_cost:,.0f}

KEY RISK DRIVERS:
{drivers_text}

Write a concise maintenance recommendation (3-5 sentences) for the fleet manager. Include:
1. Urgency and recommended action timeframe
2. What to inspect or service specifically, given the risk drivers above
3. Any operational restrictions if risk is HIGH

Be direct and specific. Use plain language. No bullet points — write as flowing prose.
Do not repeat the risk score numbers. Focus on what to DO."""


# ─────────────────────────────────────────────────────────────────────────────
# PROVIDER IMPLEMENTATIONS
# ─────────────────────────────────────────────────────────────────────────────

def _call_groq(prompt: str) -> str:
    from groq import Groq

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set in environment")

    client = Groq(api_key=api_key)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
        temperature=0.3,   # low temp = consistent, professional tone
    )
    return response.choices[0].message.content.strip()


def _call_ollama(prompt: str) -> str:
    import requests

    response = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 300},
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["response"].strip()


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────────────────────────

def generate_recommendation(snapshot: dict, prediction: dict) -> Optional[str]:
    """
    Generate a plain-English maintenance recommendation using the configured LLM.

    Returns None gracefully if:
    - LLM_PROVIDER is set to "none"
    - API key is missing
    - LLM call fails for any reason (network, rate limit, etc.)

    The caller (api/main.py) should always handle None — the prediction
    is still valid and useful without the recommendation.
    """
    if LLM_PROVIDER == "none":
        return None

    prompt = _build_prompt(snapshot, prediction)

    try:
        if LLM_PROVIDER == "groq":
            return _call_groq(prompt)
        elif LLM_PROVIDER == "ollama":
            return _call_ollama(prompt)
        else:
            print(f"[ADVISOR] Unknown LLM_PROVIDER: {LLM_PROVIDER} — skipping recommendation")
            return None

    except Exception as e:
        # Never let LLM failure break a prediction response
        print(f"[ADVISOR] LLM call failed ({LLM_PROVIDER}): {e}")
        return None


def is_available() -> bool:
    """Quick check for health endpoint — does not make an LLM call."""
    if LLM_PROVIDER == "none":
        return False
    if LLM_PROVIDER == "groq":
        return bool(os.getenv("GROQ_API_KEY"))
    if LLM_PROVIDER == "ollama":
        try:
            import requests
            r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
            return r.status_code == 200
        except Exception:
            return False
    return False