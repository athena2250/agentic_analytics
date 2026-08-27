import { useState } from "react";
import ResultTable from "./ResultTable.jsx";
import { Database, User, TrendingUp, Lightbulb, Code2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

export default function MessageBubble({ msg, onSQLClick }) {
  const isUser = msg.role === "user";
  const [sqlOpen, setSqlOpen] = useState(false);

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

            {/* Plain text (e.g. file loaded message) */}
            {msg.text && <p style={styles.aiText}>{msg.text}</p>}

            {/* SQL toggle — clicking also pushes to code panel */}
            {msg.sql && (
              <div style={styles.sqlBlock}>
                <button
                  style={styles.sqlToggle}
                  onClick={() => {
                    setSqlOpen((v) => !v);
                    onSQLClick?.(msg.sql);
                  }}
                >
                  <Code2 size={12} />
                  <span>SQL</span>
                  {sqlOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                {sqlOpen && (
                  <pre style={styles.sqlPre}>{msg.sql}</pre>
                )}
              </div>
            )}

            {/* Data table */}
            {msg.columns?.length > 0 && msg.rows?.length > 0 && (
              <div style={styles.section}>
                <ResultTable
                  columns={msg.columns}
                  rows={msg.rows}
                  totalRows={msg.total_rows ?? msg.rows.length}
                />
              </div>
            )}

            {/* Forecast */}
            {msg.forecast?.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionLabel}>
                  <TrendingUp size={12} />
                  {msg.forecast.length}-day forecast
                </div>
                <ResultTable
                  columns={Object.keys(msg.forecast[0])}
                  rows={msg.forecast}
                  totalRows={msg.forecast.length}
                />
              </div>
            )}

            {/* Insights */}
            {msg.insights && (
              <div style={styles.section}>
                <div style={styles.sectionLabel}>
                  <Lightbulb size={12} />
                  Insights
                </div>
                <p style={styles.insightText}>{msg.insights}</p>
              </div>
            )}

            {/* Error */}
            {msg.error && <p style={styles.error}>{msg.error}</p>}
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
  sqlBlock: { display: "flex", flexDirection: "column", gap: 0 },
  sqlToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: 6,
    padding: "3px 9px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  sqlPre: {
    marginTop: 6,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    overflowX: "auto",
    color: "#5a6a8a",
    lineHeight: 1.6,
    fontSize: 12,
    fontFamily: "var(--mono)",
    whiteSpace: "pre",
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
  insightText: {
    fontSize: 13,
    lineHeight: 1.7,
    color: "var(--text-soft)",
    whiteSpace: "pre-wrap",
  },
  error: { color: "#d94f4f", fontSize: 13 },
};
