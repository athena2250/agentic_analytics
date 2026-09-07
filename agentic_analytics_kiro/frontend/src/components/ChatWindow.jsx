import { useState } from "react";
import AnalyticalContextStrip from "./AnalyticalContextStrip.jsx";
import MessageList from "./MessageList.jsx";
import QuestionInput from "./QuestionInput.jsx";
import { runQueryStream, exportLast } from "../api.js";

/**
 * Turns a backend event (plan §10) into the step the trace should now show.
 * Each entry is the work that *starts* when the event arrives, so ActivityTrace
 * checks it off as soon as the following event lands — the spinning line is
 * always something the backend is actually doing, never a guess at what's next.
 *
 * Events that only complete earlier work (PROFILE_COMPLETED) return null: they
 * close the open step rather than opening one. Unknown event names also return
 * null, so a backend that grows its event set can't make this UI narrate steps
 * it doesn't understand.
 */
function stepFor(event, payload) {
  switch (event) {
    case "PROFILE_STARTED":
      return "Profiling columns";
    case "SQL_GENERATED":
      return "Validating SQL against the schema";
    case "SQL_VALIDATED":
      return payload.validation?.status === "fallback"
        ? "Generated SQL didn't validate — running a schema-driven fallback"
        : "Executing query";
    case "QUERY_EXECUTED":
      return `Preparing the answer (${payload.total_rows} row${payload.total_rows === 1 ? "" : "s"})`;
    case "INVESTIGATION_STEP":
      // Dataset-dependent work: the label is whatever the backend sent, so new
      // kinds of investigation need no change here (plan §1, §10). An event
      // analysis rides the same event, carrying its plan and per-step status
      // alongside the label rather than on a channel of its own (plan §17.3).
      return payload.label ?? null;
    default:
      return null;
  }
}

/**
 * ChatWindow — the conversation panel of plan §8. Owns one session's
 * turn-taking: asking, retrying, and handing an answer's detail to the
 * technical drawer. Rendering the stream is MessageList's job and the question
 * box is QuestionInput's.
 */
export default function ChatWindow({ session, onUpdate, onOpenTechnical }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const hasData = Object.keys(session.tables).length > 0;

  // Meta comes straight from the /query response — the backend reports which
  // tables it read, how its SQL validated, and how long it took (plan §9.4),
  // so nothing here is re-derived from the SQL text or invented.
  const openTechnical = (msg, open = true) => {
    onOpenTechnical?.(
      msg.sql,
      {
        intent: msg.intent ?? null,
        totalRows: msg.total_rows,
        tables: msg.tables_used ?? [],
        validation: msg.validation ?? null,
        serverMs: msg.duration_ms ?? null,
        durationMs: msg.durationMs,
      },
      open,
      // Every query behind an event analysis's workbook, so the drawer can show
      // more than one statement (plan §17.6). Undefined on every other turn.
      msg.sql_statements ?? undefined
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
  //
  // `roles` pins one or more of an event analysis's resolved roles (plan
  // §17.2); every other turn passes none and the backend infers as before.
  const runTurn = async (question, msgId, roles = null) => {
    setLoading(true);
    // The first step is open from the moment the request leaves: the backend is
    // generating SQL before it can report anything about it.
    const steps = [{ label: "Generating SQL" }];
    // `retryQuery` rides along from the start so the message can be retried
    // even if the failure arrives without it in scope.
    //
    // What an event analysis has planned and how far it has got, built up from
    // the same INVESTIGATION_STEP events (plan §17.3). Both stay null on every
    // other turn, so nothing renders a plan where there isn't one.
    let planned = null;
    const progress = {};
    const showProgress = () =>
      putMessage(msgId, {
        id: msgId, role: "assistant", loading: true, retryQuery: question,
        steps: [...steps], retryRoles: roles,
        event_analysis: planned ? { ...planned } : null,
        event_progress: { ...progress },
      });
    showProgress();

    const startedAt = performance.now();
    try {
      const data = await runQueryStream(session.id, question, (event, payload) => {
        // The plan arrives before any of it runs, so the list can be shown
        // while it is still being worked through (plan §17.3).
        if (payload.plan) planned = { ...(planned ?? {}), plan: payload.plan };
        if (payload.roles) planned = { ...(planned ?? {}), ...payload };
        if (payload.step_key) {
          // A step that reports "running" has, by the time the next event
          // arrives, finished — the backend only speaks when work completes.
          for (const key of Object.keys(progress)) {
            if (progress[key] === "running") progress[key] = "done";
          }
          progress[payload.step_key] =
            payload.step_status === "running" ? "running" : payload.step_status;
        }
        const label = stepFor(event, payload);
        if (!label) return;
        steps.push({ label });
        showProgress();
      }, roles);
      const aiMsg = {
        id: msgId,
        role: "assistant",
        loading: false,
        sql: data.sql,
        columns: data.columns,
        rows: data.rows,
        total_rows: data.total_rows,
        forecast: data.forecast ?? null,
        // How the forecast was fitted — which model won, whether it beat a
        // naive baseline, what the band means (plan §16). Null when no
        // forecast was produced, so nothing describes a model that didn't run.
        forecast_meta: data.forecast_meta ?? null,
        insights: data.insights ?? null,
        // The points the detector actually flagged, shown next to the
        // narrative rather than taking the model's word for them.
        anomalies: data.anomalies ?? null,
        // Cross-dataset correlation, present only on a correlate turn.
        correlation: data.correlation ?? null,
        // The resolved roles, windows, plan and skipped sub-analyses of an
        // event analysis (plan §17). Null on every other turn.
        event_analysis: data.event_analysis ?? null,
        // Every step of the plan is finished by the time the answer lands.
        event_progress: Object.fromEntries(
          (data.event_analysis?.plan ?? []).map((p) => [p.key, progress[p.key] ?? "done"])
        ),
        // The workbook is fetched from /export rather than coming down the
        // stream, so the button needs to know there is one to fetch.
        workbook_ready: data.workbook_ready ?? false,
        // Every query behind the workbook, for the technical drawer (§17.6).
        sql_statements: data.event_analysis?.sql_statements ?? null,
        retryRoles: roles,
        intent: data.intent ?? null,
        tables_used: data.tables_used ?? [],
        validation: data.validation ?? null,
        duration_ms: data.duration_ms ?? null,
        // Client-measured round trip, shown alongside the backend's own
        // server-side timing rather than in place of it.
        durationMs: performance.now() - startedAt,
        // A correlate turn states its finding in words; every other turn lets
        // the result speak for itself.
        text: data.text ?? null,
      };
      putMessage(msgId, aiMsg);
      // The session's analytical state after this turn (plan §11), kept on the
      // session so the strip above survives scrolling and message re-renders.
      if (data.context) onUpdate({ context: data.context });
      // Load the drawer with this answer's detail, but leave it collapsed:
      // the answer is primary, technical detail is on demand (plan §6).
      if (data.sql) openTechnical(aiMsg, false);
      // An .xlsx body can't come down the event stream, so an export turn ends
      // with the backend saying the file is ready and the client fetching it.
      // A download that fails is reported on the turn that asked for it, not
      // left to the console — the user would otherwise see a finished answer
      // and no file (plan §13.12).
      if (data.export_ready) {
        exportLast(session.id).catch((e) => {
          console.error(e);
          putMessage(msgId, {
            ...aiMsg,
            error: `The result was ready but the download failed: ${e.message}`,
            retryQuery: question,
          });
        });
      }
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

  // Asks a question as a normal turn, whoever composed it — the input box, a
  // suggestion, or the context strip dropping a filter (plan §11). Adjusting
  // the state that way therefore shows up in the conversation as the question
  // it really is, rather than changing the answer with no record of why.
  const ask = (question, roles = null) => {
    const q = question.trim();
    if (!q || loading) return;

    const userId = Date.now();
    onUpdate((s) => ({ messages: [...s.messages, { id: userId, role: "user", content: q }] }));
    runTurn(q, userId + 1, roles);
  };

  // Correcting a resolved role re-asks the same question with that role pinned
  // (plan §17.2). Asking again rather than patching the answer in place keeps
  // the correction in the conversation as the turn it really is — the same
  // rule the context strip follows for dropping a filter (§11).
  const confirmRole = (message, role, column) => {
    if (!message.retryQuery || loading) return;
    ask(message.retryQuery, { ...(message.retryRoles ?? {}), [role]: column });
  };

  const send = () => {
    if (!input.trim() || loading) return;
    ask(input);
    setInput("");
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

      {/* ── What the last answer analysed, and the one adjustment that can be
             made without typing: dropping a filter or the period (plan §11). ── */}
      <AnalyticalContextStrip context={session.context} onAdjust={ask} disabled={loading} />

      {/* ── Messages ── */}
      <MessageList
        messages={session.messages}
        profile={session.profile}
        hasData={hasData}
        onOpenTechnical={openTechnical}
        onRetry={(m) => runTurn(m.retryQuery, m.id, m.retryRoles)}
        canRetry={!loading}
        onPickSuggestion={ask}
        onConfirmRole={confirmRole}
        onDownloadWorkbook={() => exportLast(session.id)}
        busy={loading}
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
    borderRadius: "var(--radius-pill)",
    padding: "1px 8px",
  },
};
