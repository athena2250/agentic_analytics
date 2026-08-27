def detect_metrics_from_query(query):
    query = query.lower()

    mapping = {
        "sales": "net_sales",
        "revenue": "net_sales",
        "margin": "margin_percent",
        "profit": "net_margin",
        "transactions": "transactions",
        "trips": "trips"
    }

    detected = []

    for k, v in mapping.items():
        if k in query:
            detected.append(v)

    return list(set(detected))