import { useState, useEffect, useCallback } from "react";
import LeftPanel from "./components/LeftPanel.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import CodePanel from "./components/CodePanel.jsx";
import EmptyState from "./components/EmptyState.jsx";
import { createSession, uploadFiles, getProfile } from "./api.js";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // The SQL shown in the right code panel — updated when user clicks a message
  const [activeSQL, setActiveSQL] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => { handleNewSession(); }, []);

  const handleNewSession = useCallback(async () => {
    const { session_id } = await createSession();
    const session = {
      id: session_id,
      name: `Chat ${Date.now()}`,  // will be renamed on first message
      messages: [],
      tables: {},
      unified: null,
      uploadedFiles: [],           // [{name, size}] for the files panel
      profile: null,               // per-table column profile, once loaded
    };
    setSessions((prev) => [...prev, { ...session, name: `Chat ${prev.length + 1}` }]);
    setActiveId(session_id);
    setActiveSQL("");
  }, []);

  const updateSession = useCallback((id, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  const handleUpload = useCallback(async (files) => {
    if (!files.length || !active) return;
    setUploading(true);
    try {
      const result = await uploadFiles(active.id, files);
      const newFiles = files.map((f) => ({ name: f.name, size: f.size }));
      updateSession(active.id, {
        tables: { ...active.tables, ...result.tables },
        unified: result.unified ?? active.unified,
        uploadedFiles: [...active.uploadedFiles, ...newFiles],
        messages: [
          ...active.messages,
          {
            id: Date.now(),
            role: "assistant",
            sql: null,
            rows: result.sample,
            columns: result.sample?.length ? Object.keys(result.sample[0]) : [],
            total_rows: result.sample?.length ?? 0,
            text: `Loaded **${files.map((f) => f.name).join(", ")}**. ${Object.keys(result.tables).length} table(s) ready.`,
          },
        ],
      });
      try {
        const profile = await getProfile(active.id);
        updateSession(active.id, { profile });
      } catch (e) {
        console.error("profile fetch failed", e);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  }, [active, updateSession]);

  return (
    <div style={styles.root}>
      {/* ── Left: Files + Sessions ── */}
      <LeftPanel
        sessions={sessions}
        activeId={activeId}
        activeSession={active}
        onSelect={(id) => { setActiveId(id); setActiveSQL(""); }}
        onNew={handleNewSession}
        onRename={(id, name) => updateSession(id, { name })}
        onUpload={handleUpload}
        uploading={uploading}
      />

      {/* ── Middle: Chat ── */}
      <div style={styles.main}>
        {!active ? (
          <div style={styles.empty}>Select or start a chat</div>
        ) : Object.keys(active.tables).length === 0 ? (
          <EmptyState onUpload={handleUpload} uploading={uploading} />
        ) : (
          <ChatWindow
            key={active.id}
            session={active}
            onUpdate={(patch) => updateSession(active.id, patch)}
            onSQLClick={setActiveSQL}
          />
        )}
      </div>

      {/* ── Right: Code panel ── */}
      <CodePanel sql={activeSQL} onSQLChange={setActiveSQL} />
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
