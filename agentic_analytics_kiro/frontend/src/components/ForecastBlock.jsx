import { TrendingUp } from "lucide-react";
import ResultChart from "./ResultChart.jsx";
import ResultTable from "./ResultTable.jsx";

/**
 * ForecastBlock (plan §8): renders a forecast returned by /query.
 *
 * Column names come from the forecast rows themselves — `Object.keys` of the
 * first row — never from literals like "date"/"predicted_revenue". Once
 * `predictor.py` is generalized to take caller-specified date/value columns
 * (§9.3), whatever pair it forecasts renders here unchanged.
 *
 * The horizon label counts the rows the backend actually returned rather than
 * echoing a requested horizon the response may not have met.
 */
export default function ForecastBlock({ forecast }) {
  if (!forecast?.length) return null;

  const columns = Object.keys(forecast[0]);
  if (!columns.length) return null;

  return (
    <div style={styles.section}>
      <div style={styles.label}>
        <TrendingUp size={12} />
        {forecast.length}-day forecast
      </div>
      <ResultChart columns={columns} rows={forecast} totalRows={forecast.length} />
      <ResultTable columns={columns} rows={forecast} totalRows={forecast.length} />
    </div>
  );
}

const styles = {
  section: { display: "flex", flexDirection: "column", gap: 5 },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
};
