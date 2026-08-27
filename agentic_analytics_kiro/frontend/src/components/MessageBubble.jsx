import ResultTable from "./ResultTable.jsx";
import ResultChart from "./ResultChart.jsx";
import FindingsBlock, { deriveKPIs } from "./FindingsBlock.jsx";
import { Database, User, TrendingUp, SlidersHorizontal, Inbox, Loader2 } from "lucide-react";

export default function MessageBubble({ msg, onOpenTechnical }) {
  const isUser = msg.role === "user";

  // Findings are derived from the result's shape only — never from column names.
  const kpis = deriveKPIs(msg.columns, msg.rows);
  const kpiLabels = new Set(kpis.map((k) => k.label));
  // If every column is already shown as a KPI, the 1-row table would just repeat it.
  const tableAddsInfo =
    msg.columns?.length > 0 &&
    msg.rows?.length > 0 &&
    !msg.columns.every((c) => kpiLabels.has(c));
  const isEmptyResult = msg.columns?.length > 0 && msg.rows?.length === 0;

  return (
    <div style={{ ...styles.row, ...(isUser ? styles.rowUser : styles.rowAI) }}>
      {/* Avatar */}
      <div style={{ ...styles.avatar, ...(isUser ? styles.avatarUser : styles.avatarAI) }}>
        {isUser ? <User size={13} /> : <Database size={13} color="var(--accent)" />}
      </div>

      <div style={{ ...styles.bubble, ...(isUser ? styles.bubbleUser : styles.bubbleAI) }}>

        {/* ── User ── */}
        {isUser && <p style={styles.userText}>{msg.content}</p>}

        {/* ── AI ── */}
        {!isUser && (
          <>
            {/* Activity — one label for the one blocking backend step /query actually runs.
                No multi-step trace until the backend emits real steps (plan §10). */}
            {msg.loading && (
              <div style={styles.activity}>
                <Loader2 size={13} style={styles.spinner} />
                <span>Generating and validating query…</span>
              </div>
            )}

            {/* ── 1. Narrative: the answer, stated first ── */}
            {msg.text && <p style={styles.aiText}>{msg.text}</p>}

            {/* ── 2. Findings: insight narrative + KPI cards ── */}
            <FindingsBlock narrative={msg.insights ?? null} kpis={kpis} />

            {/* ── 3. Chart, when the result's shape supports one. Never for an
                   upload preview, whose rows are a file sample rather than an
                   answer. The table below always stays: the chart never
                   becomes the only way to read a value. ── */}
            {!msg.preview && (
              <ResultChart
                columns={msg.columns}
                rows={msg.rows}
                totalRows={msg.total_rows}
              />
            )}

            {/* ── 4. Supporting data ── */}
            {tableAddsInfo && (
              <div style={styles.section}>
                <ResultTable
                  columns={msg.columns}
                  rows={msg.rows}
                  totalRows={msg.total_rows ?? msg.rows.length}
                />
              </div>
            )}

            {/* Empty result is a valid answer, not an error (plan §13.9). */}
            {isEmptyResult && (
              <div style={styles.emptyResult}>
                <Inbox size={14} color="var(--text-muted)" />
                <span>
                  The query ran successfully but matched no rows. Try widening the
                  time range or filters.
                </span>
              </div>
            )}

            {msg.forecast?.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionLabel}>
                  <TrendingUp size={12} />
                  {msg.forecast.length}-day forecast
                </div>
                <ResultChart
                  columns={Object.keys(msg.forecast[0])}
                  rows={msg.forecast}
                  totalRows={msg.forecast.length}
                />
                <ResultTable
                  columns={Object.keys(msg.forecast[0])}
                  rows={msg.forecast}
                  totalRows={msg.forecast.length}
                />
              </div>
            )}

            {/* Error */}
            {msg.error && <p style={styles.error}>{msg.error}</p>}

            {/* ── 5. Technical detail: last, and behind one click (plan §6, §7) ── */}
            {msg.sql && (
              <button
                style={styles.techToggle}
                onClick={() => onOpenTechnical?.(msg)}
                title="Show the SQL and execution detail for this answer"
              >
                <SlidersHorizontal size={12} />
                <span>Technical details</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  row: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    marginBottom: 18,
    animation: "fadeIn 0.2s ease",
  },
  rowUser: { flexDirection: "row-reverse" },
  rowAI: {},
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  avatarAI: {
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
  },
  avatarUser: {
    background: "var(--surface3)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
  },
  bubble: {
    maxWidth: "calc(100% - 42px)",
    borderRadius: 12,
    padding: "10px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 1.6,
  },
  bubbleAI: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  bubbleUser: {
    background: "var(--accent)",
    color: "#fff",
    maxWidth: 480,
  },
  userText: { fontSize: 14, lineHeight: 1.6, color: "#fff" },
  aiText: { fontSize: 14, color: "var(--text)", lineHeight: 1.6 },
  activity: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "2px 0",
    fontSize: 13,
    color: "var(--text-muted)",
  },
  spinner: { animation: "spin 1s linear infinite", flexShrink: 0 },
  techToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: 6,
    padding: "3px 9px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  section: { display: "flex", flexDirection: "column", gap: 5 },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  emptyResult: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--text-soft)",
    lineHeight: 1.6,
  },
  error: { color: "#d94f4f", fontSize: 13 },
};
