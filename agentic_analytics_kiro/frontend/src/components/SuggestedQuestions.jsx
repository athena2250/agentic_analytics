/**
 * Schema-derived question suggestions.
 *
 * Every suggestion is built from the profile returned by GET /session/{sid}/profile —
 * no column name is assumed to exist. A suggestion is only offered when the backend
 * can actually answer it: forecast/insight prompts require a confidently-detected
 * date column (and, for forecasts, enough distinct dates for predictor.py's lag
 * features to survive), otherwise they are omitted rather than shown and failing.
 */

// Below this, the profiler is guessing at the column's role — don't build a
// suggestion on top of a guess (see plan §1: surface uncertainty, don't hide it).
const MIN_CONFIDENCE = 0.6;

// predict_sales() builds lag_7 / rolling_mean_7 features then dropna()s, so the
// first 7 grouped dates are lost and it needs >= 10 rows left to fit a model.
const MIN_DATES_FOR_FORECAST = 17;

// A breakdown axis with thousands of distinct values isn't a useful breakdown.
const MAX_DIMENSION_CARDINALITY = 50;

// Only integers get the "unique per row means it's an ID" treatment. Continuous
// measures (money, scores, rates) are naturally near-unique and must not be
// mistaken for identifiers.
const INTEGER_TYPES = ["TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT"];

function isIntegerType(dtype) {
  const t = (dtype ?? "").toUpperCase();
  return INTEGER_TYPES.some((k) => t.startsWith(k));
}

function analyzeProfile(profile) {
  const entries = Object.entries(profile?.tables ?? {});
  if (!entries.length) return null;

  // Suggestions are phrased against the largest table — the LLM resolves the
  // actual SQL, but the columns we name should at least exist somewhere real.
  const [tableName, table] = entries.reduce((a, b) =>
    (b[1].row_count ?? 0) > (a[1].row_count ?? 0) ? b : a
  );
  const cols = table.columns ?? [];
  const rowCount = table.row_count ?? 0;
  const byRole = (role) =>
    cols.filter((c) => c.role === role && (c.confidence ?? 0) >= MIN_CONFIDENCE);

  // An integer column that's unique per row is an ID the classifier didn't catch,
  // not something worth summing.
  const measures = byRole("measure").filter(
    (c) =>
      !(
        isIntegerType(c.dtype) &&
        rowCount > 1 &&
        c.distinct_count != null &&
        c.distinct_count >= rowCount * 0.98
      )
  );

  const dimensions = byRole("dimension")
    .filter(
      (c) =>
        c.distinct_count == null ||
        (c.distinct_count >= 2 && c.distinct_count <= MAX_DIMENSION_CARDINALITY)
    )
    .sort((a, b) => (a.distinct_count ?? 0) - (b.distinct_count ?? 0));

  const dates = byRole("date");

  return { tableName, multiTable: entries.length > 1, rowCount, measures, dimensions, dates };
}

export function buildSuggestions(profile) {
  const p = analyzeProfile(profile);
  if (!p) return [];

  const { tableName, multiTable, rowCount, measures, dimensions, dates } = p;
  // Only disambiguate by table when there's more than one to confuse.
  const scope = multiTable ? ` in ${tableName}` : "";

  const measure = measures[0]?.name;
  const dimension = dimensions[0]?.name;
  const dimension2 = dimensions[1]?.name;
  const date = dates[0];
  const dateName = date?.name;

  const enoughDates =
    (date?.distinct_count ?? rowCount) >= MIN_DATES_FOR_FORECAST;

  const out = [];

  if (measure && dimension) out.push(`Break down ${measure} by ${dimension}${scope}`);
  if (measure && dateName) out.push(`Show ${measure} over time by ${dateName}${scope}`);
  if (measure && dimension2) out.push(`Top 10 ${dimension2} by ${measure}${scope}`);
  if (measure && dateName && enoughDates) {
    out.push(`Forecast ${measure} for the next 7 days${scope}`);
  }
  if (measure && dateName) {
    out.push(`Analyze trends in ${measure} and explain any anomalies${scope}`);
  }

  // No usable measure — fall back to shape-of-the-data questions.
  if (!measure) {
    for (const d of dimensions.slice(0, 3)) out.push(`Count records by ${d.name}${scope}`);
    if (dateName) out.push(`Show record counts over time by ${dateName}${scope}`);
  }
  if (!out.length) out.push(`Show the first 50 rows of ${tableName}`);

  return [...new Set(out)].slice(0, 4);
}

export default function SuggestedQuestions({ profile, onPick }) {
  const suggestions = buildSuggestions(profile);
  if (!suggestions.length) return null;

  return (
    <div style={styles.wrap}>
      {suggestions.map((s) => (
        <button key={s} style={styles.chip} onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

const styles = {
  wrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 24,
    paddingLeft: 44,
  },
  chip: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text-soft)",
    borderRadius: 20,
    padding: "5px 13px",
    fontSize: 12,
    cursor: "pointer",
    transition: "border-color 0.15s, color 0.15s",
  },
};
