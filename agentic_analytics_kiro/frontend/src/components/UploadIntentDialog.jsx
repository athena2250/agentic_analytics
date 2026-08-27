import { useEffect } from "react";
import { FilePlus2, FileText, Layers, X } from "lucide-react";

/**
 * Shown when files are dropped into a session that already holds a dataset.
 * One session = one dataset (plan §5, §13.10) — so the user picks explicitly
 * between extending the current dataset and starting a clean session, instead
 * of two unrelated schemas being merged silently.
 */
export default function UploadIntentDialog({
  files, session, onAdd, onNewSession, onCancel,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const tableCount = Object.keys(session?.tables ?? {}).length;
  const fileCount = session?.uploadedFiles?.length ?? 0;

  return (
    <div style={styles.backdrop} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <button style={styles.close} onClick={onCancel} title="Cancel">
          <X size={14} />
        </button>

        <h2 style={styles.title}>Add to this dataset, or start a new one?</h2>
        <p style={styles.body}>
          <strong style={styles.strong}>{session?.name}</strong> already holds{" "}
          {tableCount} table{tableCount === 1 ? "" : "s"} from {fileCount} file
          {fileCount === 1 ? "" : "s"}. Each session keeps one dataset, so
          answers never mix columns from unrelated data.
        </p>

        <div style={styles.fileList}>
          {files.map((f) => (
            <div key={f.name} style={styles.fileRow}>
              <FileText size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <span style={styles.fileName}>{f.name}</span>
            </div>
          ))}
        </div>

        <button style={styles.option} onClick={onAdd}>
          <Layers size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={styles.optionText}>
            <span style={styles.optionTitle}>Add to this dataset</span>
            <span style={styles.optionDesc}>
              For more of the same data — extra months, extra sheets, related
              tables. Everything is queried together.
            </span>
          </span>
        </button>

        <button style={{ ...styles.option, ...styles.optionPrimary }} onClick={onNewSession}>
          <FilePlus2 size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={styles.optionText}>
            <span style={styles.optionTitle}>Start a new session</span>
            <span style={styles.optionDesc}>
              For different data. Opens a clean session with its own schema and
              conversation — <strong style={styles.strong}>{session?.name}</strong>{" "}
              stays exactly as it is.
            </span>
          </span>
        </button>

        <button style={styles.cancel} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(20,20,20,0.34)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: 24,
  },
  dialog: {
    position: "relative",
    width: "100%",
    maxWidth: 420,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "20px 20px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxShadow: "0 12px 40px rgba(0,0,0,0.14)",
  },
  close: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    padding: 2,
    borderRadius: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text)",
    letterSpacing: "-0.2px",
    margin: "0 24px 0 0",
  },
  body: {
    fontSize: 12.5,
    color: "var(--text-soft)",
    lineHeight: 1.55,
    margin: 0,
  },
  strong: { color: "var(--text)", fontWeight: 600 },
  fileList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "7px 9px",
    background: "var(--surface2)",
    borderRadius: 8,
    maxHeight: 108,
    overflowY: "auto",
  },
  fileRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  fileName: {
    fontSize: 11.5,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  option: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    textAlign: "left",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "11px 12px",
    width: "100%",
  },
  optionPrimary: {
    borderColor: "var(--accent-border)",
    background: "var(--accent-soft)",
  },
  optionText: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  optionTitle: { fontSize: 13, fontWeight: 600, color: "var(--text)" },
  optionDesc: { fontSize: 11.5, color: "var(--text-soft)", lineHeight: 1.5 },
  cancel: {
    alignSelf: "center",
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "4px 8px",
    marginTop: 2,
  },
};
