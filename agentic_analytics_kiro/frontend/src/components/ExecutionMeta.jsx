/**
 * ExecutionMeta (plan §8): how the answer was produced — intent, rows
 * returned, tables referenced, round trip.
 *
 * Every field is either returned by /query or derived client-side from the SQL
 * text; nothing is inferred that the backend doesn't report. Notably, SQL
 * validation status is *not* in the /query response, so it is absent here
 * rather than guessed at (§9.6 would add it). A field the response omitted is
 * dropped from the list rather than shown as 0 or "unknown".
 */
export default function ExecutionMeta({ meta }) {
  if (!meta) return null;

  const items = [];
  if (meta.intent) items.push(["Intent", meta.intent]);
  if (typeof meta.totalRows === "number") {
    items.push(["Rows returned", meta.totalRows.toLocaleString()]);
  }
  if (meta.tables?.length) items.push(["Tables referenced", meta.tables.join(", ")]);
  if (typeof meta.durationMs === "number") {
    // Client-measured: the backend does not report its own execution time, so
    // this is labeled a round trip rather than passed off as query time.
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
