import { X } from "lucide-react";

/**
 * AnalyticalContextStrip (plan §11): a persistent, non-chat view of what is
 * currently being analysed — the measure, the breakdown, the filters in force,
 * the period — derived by the backend from the SQL that actually ran.
 *
 * Two things it deliberately does not do: it never names a column the backend
 * didn't resolve (nothing here knows what a "metric" is for this dataset), and
 * it never claims to show the whole query — when the backend reports that part
 * of the SQL couldn't be structured, the strip says so instead of presenting a
 * partial list as complete (§1).
 *
 * "Editable" here means the one adjustment a strip can make honestly: dropping
 * a filter or the time period. That is sent as an ordinary question, so it
 * lands in the conversation as a visible turn rather than mutating state
 * behind the user's back.
 */

function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  return typeof value === "string" ? `'${value}'` : String(value);
}

function describeFilter({ column, op, value }) {
  if (op === "IS NULL" || op === "IS NOT NULL") return `${column} ${op}`;
  if (op === "BETWEEN") return `${column} between ${formatValue(value[0])} and ${formatValue(value[1])}`;
  if (op === "IN" || op === "NOT IN") return `${column} ${op.toLowerCase()} (${formatValue(value)})`;
  return `${column} ${op} ${formatValue(value)}`;
}

function describePeriod({ column, range }) {
  if (range.from != null && range.to != null) return `${column} ${range.from} → ${range.to}`;
  if (range.from != null) return `${column} from ${range.from}`;
  return `${column} up to ${range.to}`;
}

function Chip({ label, title, onRemove, removeTitle, muted }) {
  return (
    <span
      style={{ ...styles.chip, paddingRight: onRemove ? 4 : 8, ...(muted ? styles.chipMuted : null) }}
      title={title}
    >
      {label}
      {onRemove && (
        <button style={styles.remove} onClick={onRemove} title={removeTitle} aria-label={removeTitle}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

export default function AnalyticalContextStrip({ context, onAdjust, disabled }) {
  if (!context?.parsed) return null;

  const { metric, metric_aggregate, dimension, filters = [], time_period, comparison_period } = context;
  const hasState = metric_aggregate || dimension || filters.length || time_period;
  // Nothing resolved — a plain `SELECT *` has no analytical state to show, and
  // an empty strip would only take up room saying so.
  if (!hasState) return null;

  const adjust = (question) => { if (!disabled) onAdjust?.(question); };

  return (
    <div style={styles.strip}>
      <span style={styles.label}>Analyzing</span>

      {metric_aggregate && (
        <Chip
          label={`${metric_aggregate.toUpperCase()}(${metric ?? "*"})`}
          title="The measure the last query aggregated"
        />
      )}

      {dimension && <Chip label={`by ${dimension}`} title="The column the last query grouped by" />}

      {time_period && (
        <Chip
          label={describePeriod(time_period)}
          title="Time period the last query covered"
          onRemove={disabled ? null : () => adjust(
            `Ask the same question again without the time filter on ${time_period.column} — cover the full range.`
          )}
          removeTitle="Ask the same question without this time period"
        />
      )}

      {comparison_period && (
        <Chip label={`vs ${describePeriod(comparison_period)}`} title="Period the last query compared against" />
      )}

      {filters.map((filter, i) => (
        <Chip
          key={`${filter.column}-${filter.op}-${i}`}
          label={describeFilter(filter)}
          title="Filter applied by the last query"
          onRemove={disabled ? null : () => adjust(
            `Ask the same question again but without the filter ${describeFilter(filter)} — keep everything else the same.`
          )}
          removeTitle="Ask the same question without this filter"
        />
      ))}

      {context.partial && (
        <span style={styles.note} title="Parts of the query — an OR branch, or a condition this view can't represent — aren't shown above. The full SQL is in Technical details.">
          + conditions not shown
        </span>
      )}
    </div>
  );
}

const styles = {
  strip: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    padding: "8px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
  },
  label: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-muted)",
    marginRight: 2,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontFamily: "var(--mono)",
    color: "var(--accent)",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
    borderRadius: "var(--radius-pill)",
    padding: "1px 4px 1px 8px",
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chipMuted: {
    color: "var(--text-soft)",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
  },
  remove: {
    display: "flex",
    alignItems: "center",
    background: "none",
    border: "none",
    padding: "1px 2px",
    borderRadius: "var(--radius-pill)",
    color: "inherit",
    opacity: 0.7,
  },
  note: { fontSize: 11, color: "var(--text-muted)", cursor: "help" },
};
