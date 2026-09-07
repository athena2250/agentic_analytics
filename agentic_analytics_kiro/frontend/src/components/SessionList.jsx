import { useState } from "react";
import { MessageSquare, Pencil, Check } from "lucide-react";

/**
 * SessionList (plan §8): the sessions list — select, rename, and the per-row
 * dataset label — extracted from the Sidebar.
 *
 * One session holds one dataset (§5, §13.11), so each row says which dataset
 * it holds. The label is counted from the session's own tables/files; it never
 * assumes a dataset shape.
 */
function datasetLabel(session) {
  const tables = Object.keys(session.tables ?? {}).length;
  const files = session.uploadedFiles?.length ?? 0;
  if (!files) return "No dataset yet";
  return `${tables} table${tables === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}`;
}

export default function SessionList({ sessions, activeId, onSelect, onRename }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");

  const startEdit = (e, s) => {
    e.stopPropagation();
    setEditingId(s.id);
    setDraft(s.name);
  };

  const commitEdit = (id) => {
    if (draft.trim()) onRename(id, draft.trim());
    setEditingId(null);
  };

  return (
    <div style={styles.list}>
      {sessions.map((s) => (
        <div
          key={s.id}
          style={{ ...styles.row, ...(s.id === activeId ? styles.rowActive : {}) }}
          onClick={() => onSelect(s.id)}
        >
          <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.5 }} />

          {editingId === s.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitEdit(s.id)}
              onKeyDown={(e) => e.key === "Enter" && commitEdit(s.id)}
              style={styles.renameInput}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div style={styles.meta}>
              <span style={styles.name}>{s.name}</span>
              <span style={styles.dataset}>{datasetLabel(s)}</span>
            </div>
          )}

          {s.id === activeId && editingId !== s.id && (
            <button style={styles.action} onClick={(e) => startEdit(e, s)} title="Rename session">
              <Pencil size={11} />
            </button>
          )}
          {editingId === s.id && (
            <button style={styles.action} onClick={() => commitEdit(s.id)} title="Save name">
              <Check size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const styles = {
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "2px 8px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 8px",
    borderRadius: 7,
    cursor: "pointer",
    color: "var(--text-muted)",
    fontSize: 12,
    userSelect: "none",
    transition: "background 0.1s",
  },
  rowActive: { background: "var(--surface2)", color: "var(--text)" },
  meta: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, gap: 1 },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dataset: {
    fontSize: 10,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  action: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: 2,
    flexShrink: 0,
    opacity: 0.6,
    cursor: "pointer",
  },
  renameInput: {
    flex: 1,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 12,
    padding: "1px 5px",
    outline: "none",
  },
};
