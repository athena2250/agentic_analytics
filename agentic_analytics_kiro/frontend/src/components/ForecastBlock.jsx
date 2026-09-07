import { TrendingUp } from "lucide-react";
import ResultChart from "./ResultChart.jsx";
import ResultTable from "./ResultTable.jsx";
import { formatNumber } from "../format.js";
import { sectionLabel, section } from "../styles.js";

/**
 * ForecastBlock (plan §8, §16): renders a forecast returned by /query.
 *
 * Column names come from the forecast rows themselves — `Object.keys` of the
 * first row — never from literals like "date"/"predicted_revenue"; whatever
 * pair `predictor.py` fitted renders here unchanged, including the interval
 * columns it adds.
 *
 * The horizon label counts the rows the backend actually returned and spaces
 * them by the step the backend measured from the history, so weekly data isn't
 * described as a daily forecast. Everything in the footnote — which model won,
 * whether it beat a naive baseline, what the band is — is `forecast_meta` as
 * reported; when no meta comes back, nothing is claimed about the model.
 */
export default function ForecastBlock({ forecast, meta }) {
  if (!forecast?.length) return null;

  const columns = Object.keys(forecast[0]);
  if (!columns.length) return null;

  return (
    <div style={styles.section}>
      <div style={styles.label}>
        <TrendingUp size={12} />
        {horizonLabel(forecast.length, meta)}
      </div>
      <ResultChart columns={columns} rows={forecast} totalRows={forecast.length} />
      <ResultTable columns={columns} rows={forecast} totalRows={forecast.length} />
      {meta && <ForecastFootnote meta={meta} />}
    </div>
  );
}

function ForecastFootnote({ meta }) {
  const facts = [
    meta.method && `Model: ${meta.method}`,
    meta.seasonality?.length && `seasonality: ${meta.seasonality.join(", ")}`,
    // Error is only meaningful next to the baseline it was compared against.
    meta.mae != null && meta.baseline_mae != null &&
      `held-out error ${formatNumber(meta.mae)} vs ${formatNumber(meta.baseline_mae)} for a seasonal-naive baseline`,
  ].filter(Boolean);

  return (
    <div style={styles.footnote}>
      {facts.length > 0 && <div>{facts.join(" · ")}.</div>}
      {/* The backend's own caveats — that the model didn't beat the baseline,
          or that the band doesn't widen with horizon — repeated verbatim
          rather than softened. */}
      {meta.note && <div>{meta.note}</div>}
    </div>
  );
}

// Named in the unit the forecast actually steps in: daily, weekly, monthly, or
// a plain period count when the spacing is something else.
function horizonLabel(rows, meta) {
  const step = meta?.step_days;
  const unit =
    step == null ? "period"
      : near(step, 1) ? "day"
      : near(step, 7) ? "week"
      : near(step, 30, 2) ? "month"
      : "period";
  return `${rows}-${unit} forecast`;
}

const near = (value, target, tolerance = 0.5) => Math.abs(value - target) <= tolerance;

const styles = {
  section,
  label: sectionLabel,
  footnote: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 11,
    color: "var(--text-soft)",
    lineHeight: 1.5,
  },
};
