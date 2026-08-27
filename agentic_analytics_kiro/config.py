COLUMN_ALIASES = {
    "customer_id": ["user_id"],
    "transaction_id": ["order_id"],
    "date": ["date"],
    "revenue": ["revenue"],
    "cost": ["cost"],
}

SPELL_CORRECTIONS = {
    "saels": "sales",
    "revnue": "revenue",
    "departmnt": "department",
    "prodct": "product",
}

LLM_URL = "http://localhost:11434/api/generate"
LLM_MODEL = "llama3"
CACHE_TTL = 300  # seconds
