import { GitCompareArrows, AlertTriangle } from "lucide-react";

/**
 * CorrelationBlock (plan §16): the result of a cross-dataset comparison.
 *
 * Everything shown is measured by the backend — the coefficients, the number
 * of aligned periods, the grain, the best lag. Nothing here recomputes or
 * rounds a statistic the response didn't carry, and the caveats travel with
 * the numbers rather than being left for the user to supply: an association is
 * not causation, a short overlap is not evidence, and the best of several
 * scanned lags flatters itself.
 *
 * A correlation that could not be computed renders its reason instead of
 * nothing, so a correlate turn never looks like a plain query that quietly
 * dropped the comparison.
 */
export default function CorrelationBlock({ correlation }) {
  if (!correlation) return null;

  const { left, right } = correlation;
  const pair = left && right
    ? `${left.table}.${left.measure} vs ${right.table}.${right.measure}`
    : null;

  if (!correlation.available) {
    return (
      <div style={styles.unavailable}>
        <AlertTriangle size={14} color="var(--text-muted)" style={styles.icon} />
        <div>
          <div style={styles.unavailableTitle}>No correlation was computed</div>
          <div style={styles.reason}>{correlation.reason}</div>
        </div>
      </div>
    );
  }

  const best = correlation.best_lag;
  const rows = [
    ["Pearson (linear)", fmt(correlation.pearson)],
    ["Spearman (rank)", fmt(correlation.spearman)],
    ["Aligned periods", `${correlation.periods} × ${correlation.grain}`],
    correlation.p_value != null && ["p-value", formatP(correlation.p_value)],
    best && best.lag !== 0 && [
      "Strongest lag",
      `${Math.abs(best.lag)} ${correlation.grain}(s) — r = ${fmt(best.r)}`,
    ],
  ].filter(Boolean);

  return (
    <div style={styles.section}>
      <div style={styles.label}>
        <GitCompareArrows size={12} />
        {correlation.strength} {correlation.direction} correlation
      </div>
      {pair && <div style={styles.pair}>{pair}</div>}

      <div style={styles.grid}>
        {rows.map(([k, v]) => (
          <div key={k} style={styles.row}>
            <span style={styles.key}>{k}</span>
            <span style={styles.val}>{v}</span>
          </div>
        ))}
      </div>

      <div style={styles.caveat}>{correlation.caveat}</div>
      {correlation.lag_caveat && <div style={styles.caveat}>{correlation.lag_caveat}</div>}
    </div>
  );
}

// Coefficients are shown exactly as reported, to the precision the backend
// rounded them to — never re-rounded into looking more precise than measured.
const fmt = (v) => (v == null ? "—" : String(v));
const formatP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));

const styles = {
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
  },
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
  pair: { fontSize: 13, color: "var(--text)", fontWeight: 500, wordBreak: "break-word" },
  grid: { display: "flex", flexDirection: "column", gap: 2, marginTop: 2 },
  row: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 },
  key: { color: "var(--text-muted)", flexShrink: 0 },
  val: { color: "var(--text)", marginLeft: "auto", textAlign: "right" },
  caveat: { fontSize: 11, color: "var(--text-soft)", lineHeight: 1.5 },
  unavailable: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
  },
  icon: { flexShrink: 0, marginTop: 2 },
  unavailableTitle: { fontSize: 13, fontWeight: 600, color: "var(--text)" },
  reason: { fontSize: 12, color: "var(--text-soft)", lineHeight: 1.6, marginTop: 2 },
};
