import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import MessageBubble from "./MessageBubble.jsx";
import SuggestedQuestions from "./SuggestedQuestions.jsx";
import { runQuery } from "../api.js";

// Which of the session's known tables this SQL actually names. Derived by
// matching real table names against the SQL text — never a hardcoded name.
function tablesReferenced(sql, tableNames) {
  if (!sql || !tableNames?.length) return [];
  return tableNames.filter((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w"])"?${esc}"?($|[^\\w"])`, "i").test(sql);
  });
}

export default function ChatWindow({ session, onUpdate, onOpenTechnical }) {
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

  // Meta is derived from the /query response plus the SQL text — no invented fields.
  const openTechnical = (msg, open = true) => {
    onOpenTechnical?.(
      msg.sql,
      {
        intent: msg.intent ?? null,
        totalRows: msg.total_rows,
        durationMs: msg.durationMs,
        tables: tablesReferenced(msg.sql, Object.keys(session.tables)),
      },
      open
    );
  };

  // Replaces the assistant message with this id, or appends it if it isn't in
  // the list yet. Functional so a retry lands on the conversation as it stands
  // when the request returns, not as it stood when the retry was clicked.
  const putMessage = (id, next) =>
    onUpdate((s) => ({
      messages: s.messages.some((m) => m.id === id)
        ? s.messages.map((m) => (m.id === id ? next : m))
        : [...s.messages, next],
    }));

  // One conversational turn, addressed by message id. A retry reruns this with
  // the same id, so the failed answer is replaced in place rather than the
  // question being asked twice (plan §13.8).
  const runTurn = async (question, msgId) => {
    setLoading(true);
    // `retryQuery` rides along from the start so the message can be retried
    // even if the failure arrives without it in scope.
    putMessage(msgId, { id: msgId, role: "assistant", loading: true, retryQuery: question });

    const startedAt = performance.now();
    try {
      const data = await runQuery(session.id, question);
      const aiMsg = {
        id: msgId,
        role: "assistant",
        loading: false,
        sql: data.sql,
        columns: data.columns,
        rows: data.rows,
        total_rows: data.total_rows,
        forecast: data.forecast ?? null,
        insights: data.insights ?? null,
        intent: data.intent ?? null,
        // Client-measured round trip — the backend does not report its own
        // execution time, so this is labeled as a round trip, not query time.
        durationMs: performance.now() - startedAt,
        text: null,
      };
      putMessage(msgId, aiMsg);
      // Load the drawer with this answer's detail, but leave it collapsed:
      // the answer is primary, technical detail is on demand (plan §6).
      if (data.sql) openTechnical(aiMsg, false);
    } catch (e) {
      putMessage(msgId, {
        id: msgId,
        role: "assistant",
        loading: false,
        error: e.message,
        retryQuery: question,
      });
    } finally {
      setLoading(false);
    }
  };

  const send = () => {
    const q = input.trim();
    if (!q || loading) return;

    const userId = Date.now();
    onUpdate((s) => ({ messages: [...s.messages, { id: userId, role: "user", content: q }] }));
    setInput("");
    runTurn(q, userId + 1);
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
        {/* Message list */}
        {session.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            profile={session.profile}
            datasetName={session.name}
            onOpenTechnical={openTechnical}
            onRetry={(m) => runTurn(m.retryQuery, m.id)}
            canRetry={!loading}
          />
        ))}
        {/* Suggestion chips — derived from the dataset profile, shown until the
            first question is asked. The upload result is itself a message, so
            the gate is "no user turn yet", not "no messages". */}
        {!session.messages.some((m) => m.role === "user") && hasData && (
          <SuggestedQuestions profile={session.profile} onPick={setInput} />
        )}

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
