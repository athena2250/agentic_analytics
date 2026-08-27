import { useState, useEffect } from "react";
import { Code2, Copy, Check, RotateCcw } from "lucide-react";

export default function CodePanel({ sql, onSQLChange }) {
  const [copied, setCopied] = useState(false);
  const [localSQL, setLocalSQL] = useState(sql);

  // Sync when parent pushes a new SQL (from clicking a message)
  useEffect(() => {
    setLocalSQL(sql);
  }, [sql]);

  const copy = () => {
    if (!localSQL) return;
    navigator.clipboard.writeText(localSQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = () => {
    setLocalSQL(sql);
    onSQLChange(sql);
  };

  const isEmpty = !localSQL?.trim();

  return (
    <aside style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <Code2 size={14} color="var(--text-muted)" />
        <span style={styles.title}>Code</span>
        <div style={styles.actions}>
          {localSQL !== sql && (
            <button style={styles.actionBtn} onClick={reset} title="Reset">
              <RotateCcw size={12} />
            </button>
          )}
          <button style={styles.actionBtn} onClick={copy} title="Copy" disabled={isEmpty}>
            {copied ? <Check size={12} color="#4caf50" /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {/* Editor area */}
      {isEmpty ? (
        <div style={styles.placeholder}>
          <Code2 size={28} color="var(--border2)" />
          <p style={styles.placeholderText}>Click a message to view its SQL here</p>
        </div>
      ) : (
        <textarea
          style={styles.editor}
          value={localSQL}
          onChange={(e) => {
            setLocalSQL(e.target.value);
            onSQLChange(e.target.value);
          }}
          spellCheck={false}
        />
      )}

      {/* Footer hint */}
      {!isEmpty && (
        <div style={styles.footer}>
          SQL · DuckDB dialect · editable
        </div>
      )}
    </aside>
  );
}

const styles = {
  panel: {
    width: "var(--code-width)",
    minWidth: "var(--code-width)",
    background: "var(--surface)",
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text)",
  },
  actions: { display: "flex", gap: 4 },
  actionBtn: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: "3px 5px",
    borderRadius: 5,
    cursor: "pointer",
    transition: "background 0.1s",
  },
  placeholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
  },
  placeholderText: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "center",
    lineHeight: 1.5,
  },
  editor: {
    flex: 1,
    background: "var(--surface2)",
    border: "none",
    outline: "none",
    resize: "none",
    padding: "14px",
    fontSize: 12,
    fontFamily: "var(--mono)",
    color: "var(--text)",
    lineHeight: 1.7,
    overflowY: "auto",
  },
  footer: {
    padding: "6px 14px",
    fontSize: 10,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
};
