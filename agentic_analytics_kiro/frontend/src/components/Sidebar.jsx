import { useState } from "react";
import { Upload, FileText, ChevronDown, ChevronRight, Plus, Database } from "lucide-react";
import DatasetSummaryCard from "./DatasetSummaryCard.jsx";
import SchemaExplorer from "./SchemaExplorer.jsx";
import UploadProgress from "./UploadProgress.jsx";
import UploadDropzone, { useFilePicker, useDropTarget } from "./UploadDropzone.jsx";
import SessionList from "./SessionList.jsx";

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Sidebar (plan §7/§8, evolved from LeftPanel): the dataset files (via
 * UploadDropzone), the active dataset's summary, a collapsible schema
 * explorer, and the sessions list (via SessionList).
 * Renders whatever the profile reports — it knows no column names in advance.
 */
export default function Sidebar({
  sessions, activeId, activeSession,
  onSelect, onNew, onRename, onUpload, uploading,
  uploadStage, uploadError, formats
}) {
  const [filesOpen, setFilesOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);

  const uploadedFiles = activeSession?.uploadedFiles ?? [];

  // Upload plumbing lives in UploadDropzone: the picker drives the section
  // header's button and the "add to this dataset" row, while the whole panel
  // is a drop target. Both are inert without a session to upload into.
  const canUpload = Boolean(activeSession);
  const { open: openPicker, input: fileInput } = useFilePicker(onUpload, formats, canUpload);
  const { dragging, handlers: dropHandlers } = useDropTarget(onUpload, canUpload);

  return (
    <aside
      style={{
        ...styles.panel,
        ...(dragging ? styles.panelDragging : {}),
      }}
      {...dropHandlers}
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
            onClick={(e) => { e.stopPropagation(); openPicker(); }}
          >
            <Upload size={12} />
          </button>
        </button>

        {filesOpen && (
          <div style={styles.sectionBody}>
            {/* Drop hint when empty */}
            {uploadedFiles.length === 0 && !uploadStage && (
              <UploadDropzone
                variant="compact"
                onUpload={onUpload}
                formats={formats}
                disabled={!canUpload}
              />
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
                  onClick={openPicker}
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
      {activeSession?.profile && (
        <DatasetSummaryCard profile={activeSession.profile} name={activeSession.name} />
      )}

      {/* ══ SCHEMA EXPLORER ══ */}
      <SchemaExplorer profile={activeSession?.profile} />

      {/* ══ TABLES SECTION — fallback when profiling is unavailable ══ */}
      {activeSession && !activeSession.profile && Object.keys(activeSession.tables).length > 0 && (
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
          <SessionList
            sessions={sessions}
            activeId={activeId}
            onSelect={onSelect}
            onRename={onRename}
          />
        )}
      </div>

      {/* Hidden file input, owned by UploadDropzone's picker */}
      {fileInput}

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
  footer: {
    padding: "10px 14px",
    fontSize: 10,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
    textAlign: "center",
  },
};
