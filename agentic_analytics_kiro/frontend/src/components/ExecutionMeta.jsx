// How the SQL that ran was arrived at, as reported by /query. "fallback"
// means the generated SQL never validated and a schema-driven default ran
// instead — the answer is to a different question, so it is said plainly.
const VALIDATION_LABELS = {
  valid: "Validated on first attempt",
  repaired: "Repaired, then validated",
  fallback: "Generated SQL failed — schema-driven fallback used",
};

/**
 * ExecutionMeta (plan §8): how the answer was produced — intent, rows
 * returned, tables referenced, validation, timing.
 *
 * Every field is returned by /query (plan §9.4); nothing is inferred that the
 * backend doesn't report. A field the response omitted is dropped from the
 * list rather than shown as 0 or "unknown".
 */
export default function ExecutionMeta({ meta }) {
  if (!meta) return null;

  const items = [];
  if (meta.intent) items.push(["Intent", meta.intent]);
  if (typeof meta.totalRows === "number") {
    items.push(["Rows returned", meta.totalRows.toLocaleString()]);
  }
  if (meta.tables?.length) items.push(["Tables referenced", meta.tables.join(", ")]);
  if (meta.validation?.status) {
    const label = VALIDATION_LABELS[meta.validation.status] ?? meta.validation.status;
    const attempts = meta.validation.fix_attempts;
    items.push([
      "SQL validation",
      attempts ? `${label} (${attempts} fix attempt${attempts > 1 ? "s" : ""})` : label,
    ]);
  }
  if (typeof meta.serverMs === "number") {
    // Backend-reported: the time the server spent generating, validating and
    // running the query.
    items.push(["Server time", `${Math.round(meta.serverMs).toLocaleString()} ms`]);
  }
  if (typeof meta.durationMs === "number") {
    // Client-measured, so it is labeled a round trip rather than query time.
    items.push(["Round trip", `${Math.round(meta.durationMs).toLocaleString()} ms`]);
  }

  if (!items.length) return null;

  return (
    <div style={styles.meta}>
      <div style={styles.label}>Execution</div>
      {items.map(([k, v]) => (
        <div key={k} style={styles.row}>
          <span style={styles.key}>{k}</span>
          <span style={styles.val} title={String(v)}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const styles = {
  meta: { borderTop: "1px solid var(--border)", paddingBottom: 8, flexShrink: 0 },
  label: {
    padding: "8px 14px 4px",
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    flexShrink: 0,
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "3px 14px",
    fontSize: 11,
  },
  key: { color: "var(--text-muted)", flexShrink: 0 },
  val: {
    color: "var(--text)",
    marginLeft: "auto",
    textAlign: "right",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
};
