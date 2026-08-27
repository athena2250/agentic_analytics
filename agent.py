from metrics import *

def run_agent(df, parsed_plan):
    result = {}

    metrics_requested = parsed_plan.get("metrics", [])

    if "customer_count" in metrics_requested:
        result["customer_count"] = customer_count(df)

    if "transactions" in metrics_requested:
        result["transactions"] = transactions(df)

    if "trips" in metrics_requested:
        result["trips"] = trips(df)

    if "net_sales" in metrics_requested:
        result["net_sales"] = net_sales(df)

    if "net_margin" in metrics_requested:
        result["net_margin"] = net_margin(df)

    if "margin_percent" in metrics_requested:
        result["margin_percent"] = margin_percent(df)

    if "net_units" in metrics_requested:
        units = net_units(df)
        if units is not None:
            result["net_units"] = units

    if "trips_per_customer" in metrics_requested:
        result["trips_per_customer"] = trips_per_customer(df)

    if "sales_per_customer" in metrics_requested:
        result["sales_per_customer"] = sales_per_customer(df)

    if "sales_per_trip" in metrics_requested:
        result["sales_per_trip"] = sales_per_trip(df)

    return result