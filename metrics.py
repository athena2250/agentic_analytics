def customer_count(df):
    return df["customer_id"].nunique()


def transactions(df):
    return df["transaction_id"].nunique()


def trips(df):
    return len(df)  # IMPORTANT: trips = interactions


def net_sales(df):
    return df["revenue"].sum()


def net_margin(df):
    return (df["revenue"] - df["cost"]).sum()


def margin_percent(df):
    total_sales = df["revenue"].sum()
    total_margin = (df["revenue"] - df["cost"]).sum()
    return (total_margin / total_sales) * 100 if total_sales != 0 else 0


def trips_per_customer(df):
    cust = customer_count(df)
    tr = trips(df)
    return tr / cust if cust != 0 else 0


def sales_per_customer(df):
    cust = customer_count(df)
    sales = net_sales(df)
    return sales / cust if cust != 0 else 0


def sales_per_trip(df):
    tr = trips(df)
    sales = net_sales(df)
    return sales / tr if tr != 0 else 0


def net_units(df):
    return df["units"].sum() if "units" in df.columns else None