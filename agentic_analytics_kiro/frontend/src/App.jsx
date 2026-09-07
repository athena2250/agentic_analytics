import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Workspace from "./components/Workspace.jsx";
import EmptyState from "./components/EmptyState.jsx";
import UploadIntentDialog from "./components/UploadIntentDialog.jsx";
import { createSession, uploadFiles, getProfile, getFormats } from "./api.js";

// A session holding a dataset takes that dataset's name, so the sessions list
// reads as a list of datasets (plan §13.11). User renames always win.
function datasetName(files) {
  const base = files[0].name.replace(/\.[^.]+$/, "");
  const label = base.length > 28 ? `${base.slice(0, 27)}…` : base;
  return files.length > 1 ? `${label} +${files.length - 1}` : label;
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // Which real backend round trip is currently in flight: "uploading" (POST
  // /upload) → "profiling" (GET /profile) → "ready", or null when idle. Drives
  // UploadProgress; every stage maps to an actual await (plan §6, §10).
  const [uploadStage, setUploadStage] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  // Supported file extensions, read from the backend's loader rather than
  // hardcoded, so the UI can't advertise a format uploads would reject (§6).
  const [formats, setFormats] = useState(null);
  // Files dropped into a session that already holds a dataset — held here
  // until the user says whether they extend it or belong to a new one.
  const [pendingUpload, setPendingUpload] = useState(null);

  const patchSession = useCallback((id, patch) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s))
    );
  }, []);

  const startSession = useCallback(async () => {
    const { session_id } = await createSession();
    setSessions((prev) => [
      ...prev,
      {
        id: session_id,
        name: `Session ${prev.length + 1}`,  // replaced by the dataset name on upload
        renamed: false,                      // true once the user names it themselves
        messages: [],
        tables: {},
        unified: null,
        uploadedFiles: [],           // [{name, size}] for the files panel
        profile: null,               // per-table column profile, once loaded
      },
    ]);
    setActiveId(session_id);
    return session_id;
  }, []);

  useEffect(() => { startSession(); }, []);

  useEffect(() => {
    getFormats().then(setFormats).catch((e) => {
      // Leave `formats` null — the upload targets then say nothing about
      // supported formats rather than guessing at a list (plan §1).
      console.error("format list fetch failed", e);
    });
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  // "ready" is terminal — dismiss it once shown. (Dismissing a finished
  // indicator, not animating work that isn't happening.)
  useEffect(() => {
    if (uploadStage !== "ready") return;
    const t = setTimeout(() => { setUploadStage(null); setUploadError(null); }, 2500);
    return () => clearTimeout(t);
  }, [uploadStage]);

  const uploading = uploadStage === "uploading" || uploadStage === "profiling";

  // Runs the actual upload against a known session id. Every session update is
  // a functional one — the target session may have been created moments ago
  // and not yet be reflected in `active`.
  const performUpload = useCallback(async (sessionId, files) => {
    setUploadError(null);
    setUploadStage("uploading");
    try {
      const result = await uploadFiles(sessionId, files);
      const newFiles = files.map((f) => ({ name: f.name, size: f.size }));
      const names = files.map((f) => f.name).join(", ");
      patchSession(sessionId, (s) => {
        const extending = s.uploadedFiles.length > 0;
        return {
          name: !extending && !s.renamed ? datasetName(files) : s.name,
          tables: { ...s.tables, ...result.tables },
          unified: result.unified ?? s.unified,
          uploadedFiles: [...s.uploadedFiles, ...newFiles],
          messages: [
            ...s.messages,
            {
              id: Date.now(),
              role: "assistant",
              sql: null,
              rows: result.sample,
              columns: result.sample?.length ? Object.keys(result.sample[0]) : [],
              total_rows: result.sample?.length ?? 0,
              // These rows are the loader's head() sample, not a result set.
              // Charting them would draw a "trend" out of the first few rows
              // of the file — a shape that isn't in the data.
              preview: true,
              text: extending
                ? `Added **${names}** to this dataset. ${Object.keys(result.tables).length} table(s) ready — queries now cover every table in this session.`
                : `Loaded **${names}**. ${Object.keys(result.tables).length} table(s) ready.`,
            },
          ],
        };
      });
      setUploadStage("profiling");
      try {
        const profile = await getProfile(sessionId);
        patchSession(sessionId, { profile });
      } catch (e) {
        // The data is loaded and queryable; only the profile-derived extras
        // (summary card, suggestions) are missing. Say so rather than
        // reporting the whole upload as failed.
        console.error("profile fetch failed", e);
        setUploadError("Loaded, but column profiling failed — summary and suggestions are unavailable.");
      }
      setUploadStage("ready");
    } catch (err) {
      console.error(err);
      setUploadStage(null);
      setUploadError(err.message || "Upload failed.");
    }
  }, [patchSession]);

  const handleUpload = useCallback((files) => {
    if (!files.length || !active) return;
    // Adding to a session that already holds a dataset is never implicit:
    // ask first, so two unrelated schemas can't merge unnoticed (plan §13.10).
    if (active.uploadedFiles.length > 0) {
      setPendingUpload({ sessionId: active.id, files });
      return;
    }
    performUpload(active.id, files);
  }, [active, performUpload]);

  const confirmAddToDataset = useCallback(() => {
    if (!pendingUpload) return;
    const { sessionId, files } = pendingUpload;
    setPendingUpload(null);
    performUpload(sessionId, files);
  }, [pendingUpload, performUpload]);

  const confirmNewSession = useCallback(async () => {
    if (!pendingUpload) return;
    const { files } = pendingUpload;
    setPendingUpload(null);
    const sessionId = await startSession();
    performUpload(sessionId, files);
  }, [pendingUpload, startSession, performUpload]);

  return (
    <div style={styles.root}>
      {/* ── Sidebar: dataset, schema, sessions (plan §7) ── */}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        activeSession={active}
        onSelect={setActiveId}
        onNew={startSession}
        onRename={(id, name) => patchSession(id, { name, renamed: true })}
        onUpload={handleUpload}
        uploading={uploading}
        uploadStage={uploadStage}
        uploadError={uploadError}
        formats={formats}
      />

      {/* ── Onboarding view until the active session holds a dataset, then the
             workspace view: conversation + technical details drawer (plan §7). ── */}
      {!active ? (
        <div style={styles.main}>
          <div style={styles.empty}>Select or start a session</div>
        </div>
      ) : Object.keys(active.tables).length === 0 ? (
        <div style={styles.main}>
          <EmptyState
            onUpload={handleUpload}
            uploadStage={uploadStage}
            uploadError={uploadError}
            formats={formats}
          />
        </div>
      ) : (
        <Workspace
          key={active.id}
          session={active}
          onUpdate={(patch) => patchSession(active.id, patch)}
        />
      )}

      {pendingUpload && (
        <UploadIntentDialog
          files={pendingUpload.files}
          session={sessions.find((s) => s.id === pendingUpload.sessionId) ?? null}
          onAdd={confirmAddToDataset}
          onNewSession={confirmNewSession}
          onCancel={() => setPendingUpload(null)}
        />
      )}
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg)",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderLeft: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    fontSize: 14,
  },
};
