import re

NUMERIC_COLS = {"revenue", "cost"}
CATEGORICAL_COLS = {"product_name", "aisle", "department"}
DATE_COLS = {"date"}
ID_COLS = {"customer_id", "transaction_id"}

AGG_FUNCS = {"sum", "avg", "count", "min", "max"}


def validate_semantics(sql):
    sql_lower = sql.lower()

    # -------- AGGREGATION CHECK -------- #
    agg_patterns = re.findall(r"(sum|avg|min|max)\((.*?)\)", sql_lower)

    for func, col in agg_patterns:
        col = col.strip()
        if col not in NUMERIC_COLS:
            return False, f"Invalid aggregation: {func}({col}) not allowed"

    # -------- WHERE CHECK -------- #
    where_matches = re.findall(r"where (.*)", sql_lower)

    if where_matches:
        conditions = where_matches[0]

        for col in NUMERIC_COLS:
            if re.search(fr"{col}\s*=\s*'[a-z]+'", conditions):
                return False, f"Invalid filter: {col} compared to string"

    return True, "semantic valid"