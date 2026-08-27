import { Lightbulb } from "lucide-react";

// A result is KPI-shaped when it is a single row with a small number of numeric
// columns. Labels are the actual column names — nothing about the dataset is
// assumed, and no unit/currency is inferred (plan §1).
const MAX_KPIS = 6;

export function deriveKPIs(columns, rows) {
  if (!columns?.length || rows?.length !== 1) return [];
  const row = rows[0];
  const numeric = columns.filter(
    (c) => typeof row[c] === "number" && Number.isFinite(row[c])
  );
  if (!numeric.length || numeric.length > MAX_KPIS) return [];
  return numeric.map((c) => ({ label: c, value: row[c] }));
}

export function formatValue(v) {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (Number.isInteger(v)) return v.toLocaleString();
  if (abs >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function FindingsBlock({ narrative, kpis }) {
  const hasKPIs = kpis?.length > 0;
  if (!narrative && !hasKPIs) return null;

  return (
    <div style={styles.wrap}>
      {/* Narrative first — the answer, before any technical detail (plan §6). */}
      {narrative && (
        <div style={styles.narrative}>
          <Lightbulb size={12} style={styles.narrativeIcon} />
          <p style={styles.narrativeText}>{narrative}</p>
        </div>
      )}

      {hasKPIs && (
        <div style={styles.kpiGrid}>
          {kpis.map((k) => (
            <div key={k.label} style={styles.kpi}>
              <div style={styles.kpiValue}>{formatValue(k.value)}</div>
              <div style={styles.kpiLabel} title={k.label}>{k.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 },
  narrative: { display: "flex", gap: 7, alignItems: "flex-start" },
  narrativeIcon: { color: "var(--accent)", flexShrink: 0, marginTop: 4 },
  narrativeText: {
    fontSize: 14,
    lineHeight: 1.65,
    color: "var(--text)",
    whiteSpace: "pre-wrap",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 8,
  },
  kpi: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 12px",
    minWidth: 0,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: 600,
    color: "var(--text)",
    lineHeight: 1.25,
    overflowWrap: "anywhere",
  },
  kpiLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
