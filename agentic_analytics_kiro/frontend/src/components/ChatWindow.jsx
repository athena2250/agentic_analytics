import { useState, useRef, useEffect } from "react";
import { Send, Database } from "lucide-react";
import MessageBubble from "./MessageBubble.jsx";
import SuggestedQuestions from "./SuggestedQuestions.jsx";
import { runQuery } from "../api.js";

export default function ChatWindow({ session, onUpdate, onSQLClick }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef();
  const textareaRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  const hasData = Object.keys(session.tables).length > 0;

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;

    const userMsg = { id: Date.now(), role: "user", content: q };
    const thinkingId = Date.now() + 1;
    const thinkingMsg = { id: thinkingId, role: "assistant", loading: true };

    onUpdate({ messages: [...session.messages, userMsg, thinkingMsg] });
    setInput("");
    setLoading(true);

    try {
      const data = await runQuery(session.id, q);
      const aiMsg = {
        id: thinkingId,
        role: "assistant",
        loading: false,
        sql: data.sql,
        columns: data.columns,
        rows: data.rows,
        total_rows: data.total_rows,
        forecast: data.forecast ?? null,
        insights: data.insights ?? null,
        text: null,
      };
      onUpdate({ messages: [...session.messages, userMsg, aiMsg] });
      // Push SQL to code panel automatically
      if (data.sql) onSQLClick(data.sql);
    } catch (e) {
      onUpdate({
        messages: [
          ...session.messages,
          userMsg,
          { id: thinkingId, role: "assistant", loading: false, error: e.message },
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={styles.root}>
      {/* ── Top bar ── */}
      <div style={styles.topbar}>
        <span style={styles.sessionName}>{session.name}</span>
        {hasData && (
          <span style={styles.tablesBadge}>
            {Object.keys(session.tables).length} table{Object.keys(session.tables).length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Messages ── */}
      <div style={styles.messages}>
        {/* Welcome message */}
        <div style={styles.welcome}>
          <div style={styles.welcomeAvatar}>
            <Database size={18} color="var(--accent)" />
          </div>
          <div style={styles.welcomeBubble}>
            <p style={styles.welcomeTitle}>Agentic Analytics</p>
            <p style={styles.welcomeText}>
              {hasData
                ? `${Object.keys(session.tables).length} table(s) loaded. Ask me anything about your data.`
                : "Upload your data files in the left panel, then ask me anything about them."}
            </p>
          </div>
        </div>

        {/* Suggestion chips — derived from the dataset profile, only before the first question */}
        {session.messages.length === 0 && hasData && (
          <SuggestedQuestions profile={session.profile} onPick={setInput} />
        )}

        {/* Message list */}
        {session.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onSQLClick={onSQLClick}
          />
        ))}
        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* ── Input ── */}
      <div style={styles.inputArea}>
        <div style={styles.inputBox}>
          <textarea
            ref={textareaRef}
            style={styles.textarea}
            placeholder={hasData ? "What would you like to investigate?" : "Upload data first, then ask questions…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            disabled={loading}
          />
          <button
            style={{
              ...styles.sendBtn,
              ...(!input.trim() || loading ? styles.sendDisabled : {}),
            }}
            onClick={send}
            disabled={!input.trim() || loading}
          >
            <Send size={14} />
          </button>
        </div>
        <p style={styles.hint}>Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

const styles = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg)",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
  },
  sessionName: { fontSize: 13, fontWeight: 600, color: "var(--text)" },
  tablesBadge: {
    fontSize: 11,
    color: "var(--accent)",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
    borderRadius: 20,
    padding: "1px 8px",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  welcome: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    marginBottom: 20,
    animation: "fadeIn 0.3s ease",
  },
  welcomeAvatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  welcomeBubble: { paddingTop: 4 },
  welcomeTitle: { fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 },
  welcomeText: { fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6 },
  inputArea: {
    padding: "12px 20px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
  },
  inputBox: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "8px 8px 8px 14px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  textarea: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: "var(--text)",
    fontSize: 14,
    lineHeight: 1.6,
    resize: "none",
    maxHeight: 160,
    overflowY: "auto",
  },
  sendBtn: {
    background: "var(--accent)",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "opacity 0.15s",
  },
  sendDisabled: { opacity: 0.3, cursor: "not-allowed" },
  hint: { fontSize: 11, color: "var(--text-muted)", marginTop: 5, textAlign: "center" },
};
