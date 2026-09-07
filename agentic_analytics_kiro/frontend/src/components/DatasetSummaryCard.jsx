import { Calendar, Hash, Tag, Key, HelpCircle, CheckCircle2 } from "lucide-react";

function formatNum(n) {
  return n.toLocaleString();
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

/**
 * Reads the profile and reports only what it actually says (plan §6): a stat
 * whose underlying number is missing is dropped from the line rather than
 * rendered as 0 or "?" — the card never claims a fact profiling didn't produce.
 *
 * `variant`:
 *   "compact" — the persistent sidebar summary of the active dataset.
 *   "full"    — the "Dataset ready" card shown in the conversation right after
 *               an upload, which is the §6 hand-off from loading to asking.
 */
export default function DatasetSummaryCard({ profile, name, variant = "compact" }) {
  if (!profile) return null;

  const full = variant === "full";
  const tables = Object.values(profile.tables ?? {});
  const allCols = tables.flatMap((t) => t.columns ?? []);

  // Row count is only claimed when every profiled table reported one; a partial
  // sum would understate the dataset without saying so.
  const measuredRows = tables.filter((t) => typeof t.row_count === "number");
  const rowCount =
    tables.length > 0 && measuredRows.length === tables.length
      ? measuredRows.reduce((sum, t) => sum + t.row_count, 0)
      : null;
  const colCount = allCols.length;

  const counts = { date: 0, measure: 0, dimension: 0, identifier: 0, unknown: 0 };
  for (const c of allCols) {
    if (counts[c.role] != null) counts[c.role] += 1;
    else counts.unknown += 1;
  }
  const uncertain = allCols.filter((c) => c.confidence < 0.6).length;

  const span = dateSpanLabel(profile);
  const quality = qualityBadge(allCols);

  const stats = [];
  if (tables.length > 1) stats.push(`${tables.length} tables`);
  if (rowCount != null) stats.push(`${formatNum(rowCount)} rows`);
  if (colCount > 0) stats.push(`${formatNum(colCount)} columns`);
  if (span) stats.push(span);

  const detected = [
    { key: "date", n: counts.date, icon: Calendar, noun: "date field" },
    { key: "measure", n: counts.measure, icon: Hash, noun: "numerical field" },
    { key: "dimension", n: counts.dimension, icon: Tag, noun: "categorical field" },
    { key: "identifier", n: counts.identifier, icon: Key, noun: "identifier field" },
  ].filter((d) => d.n > 0);

  const s = full ? fullStyles : styles;

  return (
    <div style={s.card}>
      <div style={s.header}>
        {full && <CheckCircle2 size={15} color="var(--accent)" style={{ flexShrink: 0 }} />}
        <div style={s.title}>{full ? "Dataset ready" : name || "Dataset ready"}</div>
        {quality && (
          <span
            style={{ ...s.badge, ...styles[quality.tone] }}
            title="Based on null counts reported by profiling"
          >
            {quality.label}
          </span>
        )}
      </div>

      {full && name && <div style={s.subtitle}>{name}</div>}

      {/* Omitted entirely when profiling produced none of these numbers. */}
      {stats.length > 0 && <div style={s.stats}>{stats.join(" · ")}</div>}

      {(detected.length > 0 || uncertain > 0) && (
        <div style={s.detected}>
          <div style={s.detectedLabel}>Detected</div>
          {detected.map(({ key, n, icon: Icon, noun }) => (
            <div key={key} style={s.row}>
              <Icon size={full ? 13 : 12} color="var(--accent)" />
              <span>{n} {noun}{n > 1 ? "s" : ""}</span>
            </div>
          ))}
          {uncertain > 0 && (
            <div style={s.row}>
              <HelpCircle size={full ? 13 : 12} color="var(--text-muted)" />
              <span style={{ color: "var(--text-muted)" }}>
                {uncertain} field{uncertain > 1 ? "s" : ""} labeled with low confidence
              </span>
            </div>
          )}
        </div>
      )}
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

const fullStyles = {
  ...styles,
  card: {
    padding: "12px 14px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 10,
  },
  header: { display: "flex", alignItems: "center", gap: 7, marginBottom: 1 },
  title: { flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text)" },
  subtitle: { fontSize: 12, color: "var(--text-muted)", marginBottom: 4 },
  stats: { fontSize: 13, color: "var(--text-soft)", marginBottom: 10 },
  row: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--text)" },
  detectedLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 3,
  },
  detected: { display: "flex", flexDirection: "column", gap: 4 },
};
