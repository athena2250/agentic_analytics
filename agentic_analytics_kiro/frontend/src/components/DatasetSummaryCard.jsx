import { Calendar, Hash, Tag, Key, HelpCircle, CheckCircle2 } from "lucide-react";
import { formatCount } from "../format.js";

// Quality badge (plan §7): a restatement of the null statistics the backend's
// summary reports — not a score invented client-side. Columns profiling
// couldn't measure are excluded there rather than counted as complete.
function qualityBadge(summary) {
  const worst = summary.max_null_pct;
  if (typeof worst !== "number") return null;
  const withGaps = summary.columns_with_nulls ?? 0;
  if (worst === 0) return { label: "No missing values", tone: "good" };
  if (worst < 5) return { label: `${withGaps} field${withGaps > 1 ? "s" : ""} with few gaps`, tone: "good" };
  if (worst < 30) return { label: `Up to ${Math.round(worst)}% missing`, tone: "warn" };
  return { label: `Up to ${Math.round(worst)}% missing`, tone: "bad" };
}

/**
 * Reads the `summary` block of GET /session/{sid}/profile and reports only
 * what it actually says (plan §6, §9.4): row/column counts, date span and role
 * counts are computed server-side over the full tables, so this card never
 * re-derives them client-side or fills a gap with 0. A stat the backend
 * returned as null is dropped from the line rather than rendered as "?".
 *
 * `variant`:
 *   "compact" — the persistent sidebar summary of the active dataset.
 *   "full"    — the "Dataset ready" card shown in the conversation right after
 *               an upload, which is the §6 hand-off from loading to asking.
 */
export default function DatasetSummaryCard({ profile, name, variant = "compact" }) {
  const summary = profile?.summary;
  if (!summary) return null;

  const full = variant === "full";

  const counts = summary.role_counts ?? {};
  const span = summary.date_span;
  const quality = qualityBadge(summary);
  const uncertain = summary.uncertain_columns ?? 0;

  const stats = [];
  if (summary.table_count > 1) stats.push(`${summary.table_count} tables`);
  if (typeof summary.row_count === "number") stats.push(`${formatCount(summary.row_count)} rows`);
  if (summary.column_count > 0) stats.push(`${formatCount(summary.column_count)} columns`);
  if (span?.months) stats.push(`${span.months} month${span.months > 1 ? "s" : ""} of data`);

  const detected = [
    { key: "date", n: counts.date ?? 0, icon: Calendar, noun: "date field" },
    { key: "measure", n: counts.measure ?? 0, icon: Hash, noun: "numerical field" },
    { key: "dimension", n: counts.dimension ?? 0, icon: Tag, noun: "categorical field" },
    { key: "identifier", n: counts.identifier ?? 0, icon: Key, noun: "identifier field" },
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
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-card)",
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
    borderRadius: "var(--radius-pill)",
    padding: "1px 6px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  good: { color: "var(--accent)", background: "var(--accent-soft)" },
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
    borderRadius: "var(--radius-lg)",
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
