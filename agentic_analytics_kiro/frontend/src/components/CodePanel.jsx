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
export default function CodePanel({
  sql, meta, open, onToggle, onSQLChange, onExport, latestSQL = null,
  // Every query behind one answer, for an event analysis's workbook (plan
  // §17.6). Null on an ordinary turn, where there is only ever one statement
  // and the selector below doesn't render.
  statements = null,
}) {
  const [copied, setCopied] = useState(false);
  const [localSQL, setLocalSQL] = useState(sql);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [selected, setSelected] = useState(0);

  // Sync when parent pushes a new SQL (from clicking a message)
  useEffect(() => {
    setLocalSQL(sql);
    setExportError(null);
    setSelected(0);
  }, [sql, statements]);

  // Which of the answer's queries is on screen. A sub-analysis that was skipped
  // has no SQL of its own to show, so it is listed with its reason rather than
  // being dropped — an absent query is part of what the answer did (§17.7).
  const shown = statements?.[selected] ?? null;
  const showSQL = shown ? shown.sql : localSQL;
  const pickStatement = (i) => {
    setSelected(i);
    setLocalSQL(statements[i].sql);
  };

  const copy = () => {
    if (!showSQL) return;
    navigator.clipboard.writeText(showSQL);
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
    setExportError(null);
    try {
      await onExport();
    } catch (e) {
      // A download that silently doesn't happen is worse than a stated
      // failure — say so here rather than only in the console (plan §1).
      console.error("export failed", e);
      setExportError(e.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const isEmpty = !showSQL?.trim();
  // /export returns the session's most recent result. Offering the button
  // while an earlier answer's SQL is on screen would hand back a file that
  // doesn't match what the drawer is showing, so it is only enabled when the
  // two are the same query (plan §13.12).
  const exportsThisAnswer = Boolean(latestSQL) && sql === latestSQL;
  // Edits to the SQL aren't run anywhere — the file still contains the result
  // that actually ran.
  const edited = !statements && localSQL !== sql;

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
          {!statements && localSQL !== sql && (
            <button style={styles.actionBtn} onClick={reset} title="Reset">
              <RotateCcw size={12} />
            </button>
          )}
          <button style={styles.actionBtn} onClick={copy} title="Copy SQL" disabled={isEmpty}>
            {copied ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
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
          {statements && (
            <div style={styles.statements}>
              <div style={styles.statementsLabel}>
                {statements.length} quer{statements.length === 1 ? "y" : "ies"} behind this answer
              </div>
              <div style={styles.statementTabs}>
                {statements.map((s, i) => (
                  <button
                    key={s.title}
                    style={{
                      ...styles.statementTab,
                      ...(i === selected ? styles.statementTabActive : null),
                      ...(s.skipped ? styles.statementTabSkipped : null),
                    }}
                    onClick={() => pickStatement(i)}
                    title={s.skipped ? `Not included — ${s.skipped}` : `${s.rows} row(s)`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              {shown && (
                <p style={styles.statementNote}>
                  {shown.skipped
                    ? `Not included — ${shown.skipped}`
                    : `${shown.rows} row${shown.rows === 1 ? "" : "s"} · ${shown.validation}`}
                </p>
              )}
            </div>
          )}
          <SQLView
            value={showSQL}
            readOnly={Boolean(statements)}
            onChange={(next) => {
              if (statements) return;
              setLocalSQL(next);
              onSQLChange(next);
            }}
          />
          <ExecutionMeta meta={meta} />
          {onExport && (
            <div style={styles.exportRow}>
              <button
                style={{
                  ...styles.exportBtn,
                  ...(exportsThisAnswer && !exporting ? {} : styles.exportDisabled),
                }}
                onClick={doExport}
                disabled={!exportsThisAnswer || exporting}
                title={
                  exportsThisAnswer
                    ? (statements
                      ? "Download the multi-sheet workbook this analysis produced"
                      : "Download this answer's rows as .xlsx")
                    : "Export returns the most recent answer's rows — open technical details on that answer to export it"
                }
              >
                <Download size={12} />
                {exporting
                  ? "Exporting…"
                  : statements
                    ? "Download the workbook (.xlsx)"
                    : "Export this result (.xlsx)"}
              </button>
              {!exportsThisAnswer && (
                <p style={styles.exportNote}>
                  Export returns the most recent answer's rows. Open “Technical
                  details” on that answer to download it.
                </p>
              )}
              {exportsThisAnswer && edited && (
                <p style={styles.exportNote}>
                  Your edits above aren't run — the file contains the result of
                  the query that ran.
                </p>
              )}
              {exportError && <p style={styles.exportError}>{exportError}</p>}
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
    borderRadius: "var(--radius-xs)",
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
    borderRadius: "var(--radius-xs)",
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
  statements: {
    borderBottom: "1px solid var(--border)",
    padding: "8px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
  },
  statementsLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  },
  statementTabs: { display: "flex", flexWrap: "wrap", gap: 4 },
  statementTab: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-pill)",
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "2px 9px",
    cursor: "pointer",
  },
  statementTabActive: {
    color: "var(--accent)",
    background: "var(--accent-soft)",
    borderColor: "var(--accent-border)",
  },
  statementTabSkipped: { textDecoration: "line-through", opacity: 0.6 },
  statementNote: { margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 },
  exportRow: {
    borderTop: "1px solid var(--border)",
    padding: "8px 14px",
    flexShrink: 0,
  },
  exportDisabled: { opacity: 0.45, cursor: "not-allowed" },
  exportNote: {
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginTop: 6,
  },
  exportError: {
    fontSize: 11,
    color: "var(--danger)",
    lineHeight: 1.5,
    marginTop: 6,
  },
  exportBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "var(--radius-sm)",
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    width: "100%",
    justifyContent: "center",
  },
};
