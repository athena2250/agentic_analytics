import ResultTable from "./ResultTable.jsx";
import ResultChart from "./ResultChart.jsx";
import FindingsBlock, { deriveKPIs } from "./FindingsBlock.jsx";
import ActivityTrace from "./ActivityTrace.jsx";
import ForecastBlock from "./ForecastBlock.jsx";
import TechnicalDetailsToggle from "./TechnicalDetailsToggle.jsx";
import { Database, User, Inbox, AlertTriangle, RotateCw } from "lucide-react";

export default function MessageBubble({ msg, onOpenTechnical, onRetry, canRetry = true }) {
  const isUser = msg.role === "user";

  // Findings are derived from the result's shape only — never from column names.
  const kpis = deriveKPIs(msg.columns, msg.rows);
  const kpiLabels = new Set(kpis.map((k) => k.label));
  // If every column is already shown as a KPI, the 1-row table would just repeat it.
  const tableAddsInfo =
    msg.columns?.length > 0 &&
    msg.rows?.length > 0 &&
    !msg.columns.every((c) => kpiLabels.has(c));
  // A result that came back with no rows — including one with no columns
  // either, which would otherwise render as an empty bubble. Loading, failed
  // and narrative-only turns are not results and are excluded (plan §13.9).
  const isEmptyResult =
    !msg.loading && !msg.error && !msg.text && Array.isArray(msg.rows) && msg.rows.length === 0;
  // A forecast was asked for and none came back: predict_sales() needs a date
  // column and a numeric measure in the rows the query returned, plus enough
  // history to fit on. That happens for real — a forecast question whose SQL
  // fell back to a schema-driven aggregate returns no date column at all — and
  // rendering only the table would leave the user to guess why the forecast is
  // missing (plan §1).
  const forecastUnavailable =
    !msg.loading && !msg.error && msg.intent === "predict" && !msg.forecast?.length;

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
            {/* Activity — one label for the one blocking backend step /query
                actually runs; a real step list only once the backend emits one
                (plan §10). */}
            {msg.loading && <ActivityTrace steps={msg.steps} />}

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

            <ForecastBlock forecast={msg.forecast} />

            {/* Asked for a forecast, didn't get one — said plainly, next to the
                rows that were returned instead. */}
            {forecastUnavailable && !isEmptyResult && (
              <div style={styles.emptyResult}>
                <Inbox size={14} color="var(--text-muted)" />
                <span>
                  No forecast could be fit on these rows — a forecast needs a date
                  column and a numeric measure in the result, with enough history
                  behind them. The rows above are what the query returned.
                </span>
              </div>
            )}

            {/* Error — stated as a failed turn, with the question offered back
                for another attempt rather than requiring a retype (plan §13.8). */}
            {msg.error && (
              <div style={styles.errorBox}>
                <AlertTriangle size={14} color="var(--danger)" style={styles.errorIcon} />
                <div style={styles.errorBody}>
                  <span style={styles.errorTitle}>That question didn’t complete.</span>
                  <span style={styles.errorDetail}>{msg.error}</span>
                  {msg.retryQuery && onRetry && (
                    <button
                      style={{ ...styles.retryBtn, ...(canRetry ? {} : styles.retryDisabled) }}
                      onClick={() => onRetry(msg)}
                      disabled={!canRetry}
                      title={`Ask again: ${msg.retryQuery}`}
                    >
                      <RotateCw size={12} />
                      <span>Try again</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── 5. Technical detail: last, and behind one click (plan §6, §7) ── */}
            {msg.sql && <TechnicalDetailsToggle onOpen={() => onOpenTechnical?.(msg)} />}
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
    borderRadius: "var(--radius-xl)",
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
    boxShadow: "var(--shadow-card)",
  },
  bubbleUser: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    maxWidth: 480,
  },
  userText: { fontSize: 14, lineHeight: 1.6, color: "var(--on-accent)" },
  aiText: { fontSize: 14, color: "var(--text)", lineHeight: 1.6 },
  section: { display: "flex", flexDirection: "column", gap: 5 },
  emptyResult: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
    fontSize: 13,
    color: "var(--text-soft)",
    lineHeight: 1.6,
  },
  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    background: "var(--danger-soft)",
    border: "1px solid var(--danger-border)",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
  },
  errorIcon: { flexShrink: 0, marginTop: 2 },
  errorBody: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  errorTitle: { fontSize: 13, fontWeight: 600, color: "var(--danger)" },
  errorDetail: {
    fontSize: 12,
    color: "var(--text-soft)",
    lineHeight: 1.6,
    wordBreak: "break-word",
  },
  retryBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 9px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  retryDisabled: { opacity: 0.45, cursor: "not-allowed" },
};
