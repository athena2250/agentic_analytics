import { useState, useEffect, useCallback } from "react";
import LeftPanel from "./components/LeftPanel.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import CodePanel from "./components/CodePanel.jsx";
import { createSession } from "./api.js";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // The SQL shown in the right code panel — updated when user clicks a message
  const [activeSQL, setActiveSQL] = useState("");

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
    };
    setSessions((prev) => [...prev, { ...session, name: `Chat ${prev.length + 1}` }]);
    setActiveId(session_id);
    setActiveSQL("");
  }, []);

  const updateSession = useCallback((id, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

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
        onSessionUpdate={(patch) => active && updateSession(active.id, patch)}
      />

      {/* ── Middle: Chat ── */}
      <div style={styles.main}>
        {active ? (
          <ChatWindow
            key={active.id}
            session={active}
            onUpdate={(patch) => updateSession(active.id, patch)}
            onSQLClick={setActiveSQL}
          />
        ) : (
          <div style={styles.empty}>Select or start a chat</div>
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
