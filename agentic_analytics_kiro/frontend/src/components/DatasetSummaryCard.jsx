import { Calendar, Hash, Tag, Key, HelpCircle } from "lucide-react";

function formatNum(n) {
  return typeof n === "number" ? n.toLocaleString() : "?";
}

function dateSpanLabel(profile) {
  let earliest = null;
  let latest = null;
  for (const table of Object.values(profile.tables ?? {})) {
    for (const col of table.columns ?? []) {
      if (col.role !== "date" || col.confidence < 0.6) continue;
      const min = col.min != null ? new Date(col.min) : null;
      const max = col.max != null ? new Date(col.max) : null;
      if (min && !isNaN(min) && (!earliest || min < earliest)) earliest = min;
      if (max && !isNaN(max) && (!latest || max > latest)) latest = max;
    }
  }
  if (!earliest || !latest) return null;
  const months = Math.max(
    1,
    Math.round((latest - earliest) / (1000 * 60 * 60 * 24 * 30))
  );
  return `${months} month${months > 1 ? "s" : ""} of data`;
}

// Quality badge (plan §7): a summary of the profile's own null statistics —
// not a score invented client-side. Columns the backend couldn't measure
// (null_pct === null) are excluded rather than counted as complete.
function qualityBadge(cols) {
  const measured = cols.filter((c) => typeof c.null_pct === "number");
  if (!measured.length) return null;
  const worst = Math.max(...measured.map((c) => c.null_pct));
  const withGaps = measured.filter((c) => c.null_pct > 0).length;
  if (worst === 0) return { label: "No missing values", tone: "good" };
  if (worst < 5) return { label: `${withGaps} field${withGaps > 1 ? "s" : ""} with few gaps`, tone: "good" };
  if (worst < 30) return { label: `Up to ${Math.round(worst)}% missing`, tone: "warn" };
  return { label: `Up to ${Math.round(worst)}% missing`, tone: "bad" };
}

export default function DatasetSummaryCard({ profile, name }) {
  if (!profile) return null;

  const tables = Object.values(profile.tables ?? {});
  const rowCount = tables.reduce((sum, t) => sum + (t.row_count ?? 0), 0);
  const allCols = tables.flatMap((t) => t.columns ?? []);
  const colCount = allCols.length;

  const counts = { date: 0, measure: 0, dimension: 0, identifier: 0, unknown: 0 };
  for (const c of allCols) {
    if (counts[c.role] != null) counts[c.role] += 1;
    else counts.unknown += 1;
  }
  const uncertain = allCols.filter((c) => c.confidence < 0.6).length;

  const span = dateSpanLabel(profile);
  const quality = qualityBadge(allCols);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div style={styles.title}>{name || "Dataset ready"}</div>
        {quality && (
          <span style={{ ...styles.badge, ...styles[quality.tone] }} title="Based on null counts reported by profiling">
            {quality.label}
          </span>
        )}
      </div>
      <div style={styles.stats}>
        {formatNum(rowCount)} rows · {formatNum(colCount)} columns
        {span ? ` · ${span}` : ""}
      </div>
      <div style={styles.detected}>
        <div style={styles.detectedLabel}>Detected</div>
        {counts.date > 0 && (
          <div style={styles.row}>
            <Calendar size={12} color="var(--accent)" />
            <span>{counts.date} date field{counts.date > 1 ? "s" : ""}</span>
          </div>
        )}
        {counts.measure > 0 && (
          <div style={styles.row}>
            <Hash size={12} color="var(--accent)" />
            <span>{counts.measure} numerical field{counts.measure > 1 ? "s" : ""}</span>
          </div>
        )}
        {counts.dimension > 0 && (
          <div style={styles.row}>
            <Tag size={12} color="var(--accent)" />
            <span>{counts.dimension} categorical field{counts.dimension > 1 ? "s" : ""}</span>
          </div>
        )}
        {counts.identifier > 0 && (
          <div style={styles.row}>
            <Key size={12} color="var(--accent)" />
            <span>{counts.identifier} identifier field{counts.identifier > 1 ? "s" : ""}</span>
          </div>
        )}
        {uncertain > 0 && (
          <div style={styles.row}>
            <HelpCircle size={12} color="var(--text-muted)" />
            <span style={{ color: "var(--text-muted)" }}>
              {uncertain} field{uncertain > 1 ? "s" : ""} labeled with low confidence
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    margin: "8px 12px",
    padding: "10px 12px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    fontSize: 9.5,
    fontWeight: 600,
    borderRadius: 999,
    padding: "1px 6px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  good: { color: "var(--accent)", background: "rgba(124,106,247,0.10)" },
  warn: { color: "var(--text-soft)", background: "var(--surface2)" },
  bad: { color: "var(--text-soft)", background: "var(--surface2)", border: "1px solid var(--border2)" },
  stats: { fontSize: 11, color: "var(--text-soft)", marginBottom: 8 },
  detected: { display: "flex", flexDirection: "column", gap: 3 },
  detectedLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 2,
  },
  row: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text)" },
};
