# SPELL_CORRECTIONS is a LEGACY sales-domain literal, read only by the old CLI
# in app.py.
#
# It may not be used from api.py: the live /query and /profile paths assume no
# column name in advance (plan §1, §15). api.py corrects typos against the
# session's own loaded schema instead; see api._normalize.
SPELL_CORRECTIONS = {
    "saels": "sales",
    "revnue": "revenue",
    "departmnt": "department",
    "prodct": "product",
}

LLM_URL = "http://localhost:11434/api/generate"
LLM_MODEL = "llama3"
CACHE_TTL = 300  # seconds
