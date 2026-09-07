import { useState, useEffect } from "react";
import {
  SlidersHorizontal, Copy, Check, RotateCcw, Download,
  PanelRightOpen, PanelRightClose,
} from "lucide-react";
import SQLView from "./SQLView.jsx";
import ExecutionMeta from "./ExecutionMeta.jsx";

/**
 * Technical Details drawer (plan §7/§8): SQL editor + execution meta.
 * Collapsed to a rail by default — the answer in the conversation is primary,
 * this is opened on demand from a message's "Technical details" button.
 *
 * Composed of SQLView (the editor) and ExecutionMeta (how the answer was
 * produced); this file owns the drawer chrome — rail, header, copy/reset,
 * export — and the SQL draft the user may edit.
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
          <SQLView
            value={localSQL}
            onChange={(next) => { setLocalSQL(next); onSQLChange(next); }}
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
