# LEGACY — sales-domain literals, read only by the old CLI in app.py.
#
# Neither table may be used from api.py: the live /query and /profile paths
# assume no column name in advance (plan §1, §15). api.py corrects typos
# against the session's own loaded schema instead; see api._normalize.
# COLUMN_ALIASES has no reader at all and is kept only so app.py's module
# contract is unchanged.
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
