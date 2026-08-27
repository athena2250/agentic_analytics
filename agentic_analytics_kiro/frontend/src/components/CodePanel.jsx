import { useState, useEffect } from "react";
import {
  SlidersHorizontal, Copy, Check, RotateCcw, Download,
  PanelRightOpen, PanelRightClose,
} from "lucide-react";

/**
 * Technical Details drawer (plan §7/§8): SQL editor + execution meta.
 * Collapsed to a rail by default — the answer in the conversation is primary,
 * this is opened on demand from a message's "Technical details" button.
 *
 * Every meta field shown here is either returned by /query or derived from the
 * SQL text client-side. Nothing is inferred that the backend doesn't report —
 * notably, SQL validation status is not in the /query response, so it is not
 * displayed rather than guessed at.
 */
export default function CodePanel({ sql, meta, open, onToggle, onSQLChange, onExport }) {
  const [copied, setCopied] = useState(false);
  const [localSQL, setLocalSQL] = useState(sql);
  const [exporting, setExporting] = useState(false);

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

  const doExport = async () => {
    if (!onExport || exporting) return;
    setExporting(true);
    try {
      await onExport();
    } catch (e) {
      console.error("export failed", e);
    } finally {
      setExporting(false);
    }
  };

  const isEmpty = !localSQL?.trim();

  // ── Collapsed rail ──
  if (!open) {
    return (
      <aside style={styles.rail}>
        <button style={styles.railBtn} onClick={onToggle} title="Open technical details">
          <PanelRightOpen size={15} />
        </button>
        <div style={styles.railLabel}>
          Technical details
          {!isEmpty && <span style={styles.railDot} />}
        </div>
      </aside>
    );
  }

  return (
    <aside style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <SlidersHorizontal size={14} color="var(--text-muted)" />
        <span style={styles.title}>Technical details</span>
        <div style={styles.actions}>
          {localSQL !== sql && (
            <button style={styles.actionBtn} onClick={reset} title="Reset">
              <RotateCcw size={12} />
            </button>
          )}
          <button style={styles.actionBtn} onClick={copy} title="Copy SQL" disabled={isEmpty}>
            {copied ? <Check size={12} color="#4caf50" /> : <Copy size={12} />}
          </button>
          <button style={styles.actionBtn} onClick={onToggle} title="Collapse">
            <PanelRightClose size={13} />
          </button>
        </div>
      </div>

      {/* Editor area */}
      {isEmpty ? (
        <div style={styles.placeholder}>
          <SlidersHorizontal size={26} color="var(--border2)" />
          <p style={styles.placeholderText}>
            Open “Technical details” on an answer to inspect its SQL here
          </p>
        </div>
      ) : (
        <>
          <div style={styles.sectionLabel}>SQL · DuckDB dialect · editable</div>
          <textarea
            style={styles.editor}
            value={localSQL}
            onChange={(e) => {
              setLocalSQL(e.target.value);
              onSQLChange(e.target.value);
            }}
            spellCheck={false}
          />
          <ExecutionMeta meta={meta} />
          {onExport && (
            <div style={styles.exportRow}>
              <button style={styles.exportBtn} onClick={doExport} disabled={exporting}>
                <Download size={12} />
                {exporting ? "Exporting…" : "Export last result (.xlsx)"}
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function ExecutionMeta({ meta }) {
  if (!meta) return null;
  const items = [];

  if (meta.intent) items.push(["Intent", meta.intent]);
  if (typeof meta.totalRows === "number") {
    items.push(["Rows returned", meta.totalRows.toLocaleString()]);
  }
  if (meta.tables?.length) items.push(["Tables referenced", meta.tables.join(", ")]);
  if (typeof meta.durationMs === "number") {
    items.push(["Round trip", `${Math.round(meta.durationMs).toLocaleString()} ms`]);
  }

  if (!items.length) return null;

  return (
    <div style={styles.meta}>
      <div style={styles.sectionLabel}>Execution</div>
      {items.map(([k, v]) => (
        <div key={k} style={styles.metaRow}>
          <span style={styles.metaKey}>{k}</span>
          <span style={styles.metaVal} title={String(v)}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const styles = {
  rail: {
    width: 40,
    minWidth: 40,
    background: "var(--surface)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    overflow: "hidden",
  },
  railBtn: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    padding: 4,
    borderRadius: 5,
  },
  railLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    writingMode: "vertical-rl",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
  },
  railDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
  },
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
  sectionLabel: {
    padding: "8px 14px 4px",
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    flexShrink: 0,
  },
  editor: {
    flex: 1,
    minHeight: 120,
    background: "var(--surface2)",
    border: "none",
    outline: "none",
    resize: "none",
    padding: "12px 14px",
    fontSize: 12,
    fontFamily: "var(--mono)",
    color: "var(--text)",
    lineHeight: 1.7,
    overflowY: "auto",
  },
  meta: {
    borderTop: "1px solid var(--border)",
    paddingBottom: 8,
    flexShrink: 0,
  },
  metaRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    padding: "3px 14px",
    fontSize: 11,
  },
  metaKey: { color: "var(--text-muted)", flexShrink: 0 },
  metaVal: {
    color: "var(--text)",
    marginLeft: "auto",
    textAlign: "right",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  exportRow: {
    borderTop: "1px solid var(--border)",
    padding: "8px 14px",
    flexShrink: 0,
  },
  exportBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    width: "100%",
    justifyContent: "center",
  },
};
