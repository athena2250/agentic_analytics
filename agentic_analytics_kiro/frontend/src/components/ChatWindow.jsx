import { useState } from "react";
import MessageList from "./MessageList.jsx";
import QuestionInput from "./QuestionInput.jsx";
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

/**
 * ConversationPanel (plan §8, evolved from ChatWindow): owns one session's
 * turn-taking — asking, retrying, and handing an answer's detail to the
 * technical drawer. Rendering the stream is MessageList's job and the question
 * box is QuestionInput's.
 */
export default function ChatWindow({ session, onUpdate, onOpenTechnical }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

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
      <MessageList
        messages={session.messages}
        profile={session.profile}
        datasetName={session.name}
        hasData={hasData}
        onOpenTechnical={openTechnical}
        onRetry={(m) => runTurn(m.retryQuery, m.id)}
        canRetry={!loading}
        onPickSuggestion={setInput}
      />

      {/* ── Input ── */}
      <QuestionInput
        value={input}
        onChange={setInput}
        onSend={send}
        disabled={loading}
        hasData={hasData}
      />
    </div>
  );
}

const styles = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    // minHeight over a fixed 100vh: the banner above is a sibling in the same
    // column, so the panel takes the space that's left rather than the screen.
    minHeight: 0,
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
};
