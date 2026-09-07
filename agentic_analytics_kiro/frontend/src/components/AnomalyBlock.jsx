import { Activity } from "lucide-react";
import { formatNumber } from "../format.js";
import { sectionLabel, section } from "../styles.js";

/**
 * AnomalyBlock (plan §16): the points the detector actually flagged, shown
 * beside the analyst narrative on an insight turn.
 *
 * The narrative is written by the model; this list is not. Showing both means
 * a reader can check the prose against what was measured — including the case
 * where nothing was unusual, which is stated rather than left blank, and the
 * case where the series was too short or too flat to judge.
 *
 * The method and threshold come from the response: a seasonally adjusted call
 * and a plain one mean different things, and a point flagged for being rare in
 * an otherwise constant series has no z-score to quote.
 */
export default function AnomalyBlock({ anomalies }) {
  if (!anomalies || !anomalies.measure_column) return null;

  const { found, points = [], count, method, note, measure_column } = anomalies;

  return (
    <div style={styles.section}>
      <div style={styles.label}>
        <Activity size={12} />
        {found ? `${count} unusual point${count === 1 ? "" : "s"}` : "Nothing unusual"}
        <span style={styles.in}>in {measure_column}</span>
      </div>

      {found && (
        <div style={styles.list}>
          {points.map((p, i) => (
            <div key={i} style={styles.row}>
              <span style={styles.when}>{p.when ? p.when.slice(0, 10) : `row ${i + 1}`}</span>
              <span style={styles.value}>{formatNumber(p.value, 4)}</span>
              <span style={{ ...styles.tag, ...(p.direction === "low" ? styles.low : styles.high) }}>
                {p.direction}
              </span>
              {/* Absent for a rarity call, where no score was computed. */}
              {p.score != null && <span style={styles.score}>z {p.score}</span>}
            </div>
          ))}
          {count > points.length && (
            <div style={styles.more}>
              {count - points.length} more not shown
            </div>
          )}
        </div>
      )}

      <div style={styles.note}>
        {note}
        {method ? ` Method: ${method}.` : ""}
      </div>
    </div>
  );
}

const styles = {
  section,
  label: sectionLabel,
  in: { fontWeight: 500, textTransform: "none", letterSpacing: 0 },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "8px 10px",
  },
  row: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 },
  when: { color: "var(--text-muted)", flexShrink: 0, fontVariantNumeric: "tabular-nums" },
  value: { color: "var(--text)", fontWeight: 500, fontVariantNumeric: "tabular-nums" },
  tag: { fontSize: 10, borderRadius: 4, padding: "1px 5px", textTransform: "uppercase" },
  high: { background: "var(--accent-soft)", color: "var(--accent)" },
  low: { background: "var(--danger-soft)", color: "var(--danger)" },
  score: { marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 },
  more: { fontSize: 11, color: "var(--text-muted)" },
  note: { fontSize: 11, color: "var(--text-soft)", lineHeight: 1.5 },
};
