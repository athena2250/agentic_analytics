import { useState, useRef } from "react";
import {
  Upload, FileText, ChevronDown, ChevronRight,
  Plus, MessageSquare, Pencil, Check, Trash2, Database
} from "lucide-react";
import DatasetSummaryCard from "./DatasetSummaryCard.jsx";
import UploadProgress from "./UploadProgress.jsx";

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// One session = one dataset, so each row says which dataset it holds.
function datasetLabel(session) {
  const tables = Object.keys(session.tables ?? {}).length;
  const files = session.uploadedFiles?.length ?? 0;
  if (!files) return "No dataset yet";
  return `${tables} table${tables === 1 ? "" : "s"} · ${files} file${files === 1 ? "" : "s"}`;
}

export default function LeftPanel({
  sessions, activeId, activeSession,
  onSelect, onNew, onRename, onUpload, uploading,
  uploadStage, uploadError, formats
}) {
  // Accepted extensions come from GET /formats (derived from loader.py's
  // readers), so the picker can't offer a format the backend would reject (§6).
  const accepted = formats?.map((f) => `.${f}`).join(",");
  const [filesOpen, setFilesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef();

  const uploadedFiles = activeSession?.uploadedFiles ?? [];

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!activeSession) return;
    onUpload(Array.from(e.dataTransfer.files));
  };

  const handleBrowse = (e) => {
    if (activeSession) onUpload(Array.from(e.target.files));
    e.target.value = "";
  };

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
    <aside
      style={{
        ...styles.panel,
        ...(dragging ? styles.panelDragging : {}),
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* ── Logo ── */}
      <div style={styles.logo}>
        <Database size={16} color="var(--accent)" />
        <span style={styles.logoText}>Agentic Analytics</span>
      </div>

      {/* ══ FILES SECTION ══ */}
      <div style={styles.section}>
        <button style={styles.sectionHeader} onClick={() => setFilesOpen((v) => !v)}>
          {filesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={styles.sectionTitle}>Dataset files</span>
          <button
            style={styles.addBtn}
            title="Add files to this dataset"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
          >
            <Upload size={12} />
          </button>
        </button>

        {filesOpen && (
          <div style={styles.sectionBody}>
            {/* Drop hint when empty */}
            {uploadedFiles.length === 0 && !uploadStage && (
              <div
                style={styles.dropHint}
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={14} color="var(--text-muted)" />
                <span style={styles.dropHintText}>Drop files or click to upload</span>
              </div>
            )}

            {/* Real per-request progress, not a spinner (plan §6, §10) */}
            <UploadProgress stage={uploadStage} error={uploadError} compact />

            {/* File list */}
            {uploadedFiles.map((f) => (
              <div key={f.name} style={styles.fileRow}>
                <FileText size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <span style={styles.fileName}>{f.name}</span>
                <span style={styles.fileSize}>{formatSize(f.size)}</span>
              </div>
            ))}

            {/* Upload more, plus the explicit route for unrelated data */}
            {uploadedFiles.length > 0 && (
              <>
                <button
                  style={styles.uploadMoreBtn}
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload size={11} />
                  Add to this dataset
                </button>
                <button style={styles.newDatasetHint} onClick={onNew}>
                  Different data? Start a new session
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ══ DATASET SUMMARY ══ */}
      {activeSession?.profile && <DatasetSummaryCard profile={activeSession.profile} />}

      {/* ══ TABLES SECTION ══ */}
      {activeSession && Object.keys(activeSession.tables).length > 0 && (
        <div style={styles.section}>
          <button style={styles.sectionHeader} onClick={() => {}}>
            <ChevronDown size={13} />
            <span style={styles.sectionTitle}>Tables</span>
          </button>
          <div style={styles.sectionBody}>
            {Object.entries(activeSession.tables).map(([tname, cols]) => (
              <div key={tname} style={styles.tableRow}>
                <Database size={12} color="var(--accent)" style={{ flexShrink: 0 }} />
                <div style={styles.tableInfo}>
                  <span style={styles.tableName}>{tname}</span>
                  <span style={styles.tableCols}>{cols.length} cols</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ CHATS SECTION ══ */}
      <div style={{ ...styles.section, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <button style={styles.sectionHeader} onClick={() => setChatsOpen((v) => !v)}>
          {chatsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={styles.sectionTitle}>Sessions</span>
          <button
            style={styles.addBtn}
            title="New session — a clean slate for a different dataset"
            onClick={(e) => { e.stopPropagation(); onNew(); }}
          >
            <Plus size={12} />
          </button>
        </button>

        {chatsOpen && (
          <div style={styles.chatList}>
            {sessions.map((s) => (
              <div
                key={s.id}
                style={{
                  ...styles.chatRow,
                  ...(s.id === activeId ? styles.chatRowActive : {}),
                }}
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
                  <div style={styles.chatMeta}>
                    <span style={styles.chatName}>{s.name}</span>
                    <span style={styles.chatDataset}>{datasetLabel(s)}</span>
                  </div>
                )}

                {s.id === activeId && editingId !== s.id && (
                  <button style={styles.rowAction} onClick={(e) => startEdit(e, s)}>
                    <Pencil size={11} />
                  </button>
                )}
                {editingId === s.id && (
                  <button style={styles.rowAction} onClick={() => commitEdit(s.id)}>
                    <Check size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        {...(accepted ? { accept: accepted } : {})}
        style={{ display: "none" }}
        onChange={handleBrowse}
      />

      <div style={styles.footer}>
        Powered by Ollama · DuckDB
      </div>
    </aside>
  );
}

const styles = {
  panel: {
    width: "var(--panel-width)",
    minWidth: "var(--panel-width)",
    background: "var(--surface)",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border)",
    overflow: "hidden",
    transition: "background 0.15s",
  },
  panelDragging: {
    background: "rgba(124,106,247,0.04)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "14px 14px 10px",
    borderBottom: "1px solid var(--border)",
  },
  logoText: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text)",
    letterSpacing: "-0.2px",
  },
  section: {
    borderBottom: "1px solid var(--border)",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    width: "100%",
    background: "none",
    border: "none",
    padding: "8px 12px",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    cursor: "pointer",
    userSelect: "none",
  },
  sectionTitle: { flex: 1, textAlign: "left" },
  addBtn: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: "2px 4px",
    borderRadius: 4,
    cursor: "pointer",
  },
  sectionBody: {
    padding: "2px 8px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  dropHint: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    padding: "14px 8px",
    border: "1.5px dashed var(--border2)",
    borderRadius: 8,
    cursor: "pointer",
    margin: "4px 0",
  },
  dropHintText: { fontSize: 11, color: "var(--text-muted)", textAlign: "center" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 6px",
    borderRadius: 6,
    cursor: "default",
  },
  fileName: {
    flex: 1,
    fontSize: 12,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileSize: { fontSize: 10, color: "var(--text-muted)", flexShrink: 0 },
  uploadMoreBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
    marginTop: 2,
    width: "100%",
    justifyContent: "center",
  },
  newDatasetHint: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 10.5,
    padding: "3px 4px 0",
    textAlign: "center",
    width: "100%",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  tableRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px",
    borderRadius: 6,
  },
  tableInfo: { display: "flex", flexDirection: "column", minWidth: 0 },
  tableName: {
    fontSize: 12,
    color: "var(--text)",
    fontFamily: "var(--mono)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tableCols: { fontSize: 10, color: "var(--text-muted)" },
  chatList: {
    flex: 1,
    overflowY: "auto",
    padding: "2px 8px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  chatRow: {
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
  chatRowActive: {
    background: "var(--surface2)",
    color: "var(--text)",
  },
  chatMeta: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    gap: 1,
  },
  chatName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatDataset: {
    fontSize: 10,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowAction: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: 2,
    flexShrink: 0,
    opacity: 0.6,
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
  footer: {
    padding: "10px 14px",
    fontSize: 10,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    textAlign: "center",
  },
};
