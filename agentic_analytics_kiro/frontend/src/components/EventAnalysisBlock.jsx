import { useState } from "react";
import {
  Check, CircleSlash, Loader2, Download, AlertTriangle, Pencil,
} from "lucide-react";

/**
 * EventAnalysisBlock (plan §17.6): everything an event-analysis turn produces
 * that isn't a table — the resolved role mapping, the plan and how far it got,
 * what was left out and why, and the workbook itself.
 *
 * Three things it deliberately does:
 *
 * * **It distinguishes a guess from an answer.** §17.2 requires "inferred" and
 *   "confirmed" to be told apart, so each role carries its badge and the
 *   evidence behind it. A role the backend couldn't fill says so rather than
 *   being omitted.
 * * **It makes the mapping editable.** Confirming a different column re-asks
 *   the same question with that role pinned, which lands in the conversation as
 *   a visible turn — the same rule the context strip follows.
 * * **It shows the skipped sub-analyses.** A plan is only useful if what didn't
 *   run is as visible as what did (§17.7).
 *
 * Nothing here knows what any role *means* for a dataset: every column name on
 * screen came from the backend's resolution (§1).
 */

const ROLE_HELP = {
  entity: "the column identifying a repeat actor",
  event_key: "the column identifying one interaction",
  cross_dim: "the dimension an actor can span",
  measure: "the numeric columns totalled",
  time: "the date the analysis is placed on",
};

function columnLabel(column) {
  if (Array.isArray(column)) return column.length ? column.join(", ") : "none";
  return column ?? "not resolved";
}

function RoleRow({ name, role, onConfirm, disabled }) {
  const [open, setOpen] = useState(false);
  // Only a single-column role can be re-pinned from here; a multi-column role
  // (the measures) is corrected by naming them in the question.
  const options = Array.isArray(role.column) ? [] : role.candidates ?? [];
  const badge =
    role.source === "confirmed" ? styles.badgeConfirmed
      : role.source === "unresolved" ? styles.badgeUnresolved
        : styles.badgeInferred;

  return (
    <div style={styles.roleRow}>
      <div style={styles.roleHead}>
        <span style={styles.roleName}>{name}</span>
        <span style={styles.roleHelp}>{ROLE_HELP[name] ?? ""}</span>
      </div>
      <div style={styles.roleBody}>
        <code style={styles.roleColumn}>{columnLabel(role.column)}</code>
        <span style={{ ...styles.badge, ...badge }}>{role.source}</span>
        {options.length > 0 && onConfirm && (
          <button
            style={styles.linkBtn}
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            title="Use a different column for this role"
          >
            <Pencil size={11} />
            change
          </button>
        )}
      </div>
      <p style={styles.roleWhy}>{role.why}</p>
      {open && (
        <div style={styles.options}>
          {options.map((candidate) => (
            <button
              key={candidate}
              style={styles.optionBtn}
              disabled={disabled}
              onClick={() => { setOpen(false); onConfirm(name, candidate); }}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepIcon({ step }) {
  if (step.skipped) return <CircleSlash size={12} color="var(--text-muted)" style={styles.icon} />;
  if (step.done) return <Check size={12} color="var(--accent)" style={styles.icon} />;
  return <Loader2 size={12} style={{ ...styles.icon, ...styles.spinner }} />;
}

export default function EventAnalysisBlock({
  analysis, progress, onConfirmRole, onDownload, downloading, disabled,
}) {
  if (!analysis) return null;
  const { roles = {}, windows, plan = [], skipped = [], notes = [], blocked } = analysis;
  const skippedReasons = Object.fromEntries(skipped.map((s) => [s.title, s.reason]));

  return (
    <div style={styles.root}>
      {blocked && (
        <div style={styles.blocked}>
          <AlertTriangle size={13} color="var(--danger)" style={styles.icon} />
          <span>{blocked}</span>
        </div>
      )}

      {/* ── What each column was taken to mean ── */}
      {Object.keys(roles).length > 0 && (
        <section style={styles.section}>
          <h4 style={styles.heading}>What each column was taken to mean</h4>
          {Object.entries(roles).map(([name, role]) => (
            <RoleRow
              key={name}
              name={name}
              role={role}
              onConfirm={onConfirmRole}
              disabled={disabled}
            />
          ))}
        </section>
      )}

      {/* ── The windows, stated rather than implied (§17.3) ── */}
      {windows?.event && (
        <section style={styles.section}>
          <h4 style={styles.heading}>Windows</h4>
          <p style={styles.line}>
            Event: <strong>{windows.event.start}</strong> to <strong>{windows.event.end}</strong>
            {" "}({windows.event.days} day{windows.event.days === 1 ? "" : "s"})
          </p>
          {windows.baseline?.map((b) => (
            <p key={b.label} style={styles.lineMuted}>
              {b.label}: {b.start} to {b.end}
            </p>
          ))}
          <p style={styles.note}>{windows.note}</p>
        </section>
      )}

      {/* ── The plan, and how far it got ── */}
      {plan.length > 0 && (
        <section style={styles.section}>
          <h4 style={styles.heading}>Plan</h4>
          {plan.map((step) => {
            const state = progress?.[step.key];
            const reason = step.skipped || skippedReasons[step.title];
            return (
              <div key={step.key} style={styles.step}>
                <StepIcon
                  step={{
                    skipped: Boolean(reason),
                    done: state === "done" || (!state && !reason),
                  }}
                />
                <div style={styles.stepBody}>
                  <span style={reason ? styles.stepSkipped : styles.stepLabel}>{step.title}</span>
                  <span style={styles.stepDesc}>{step.description}</span>
                  {reason && <span style={styles.stepReason}>Not included — {reason}</span>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {notes.map((note) => (
        <p key={note} style={styles.note}>{note}</p>
      ))}

      {onDownload && (
        <button style={styles.download} onClick={onDownload} disabled={downloading}>
          <Download size={12} />
          {downloading ? "Preparing…" : "Download the workbook (.xlsx)"}
        </button>
      )}
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 10,
    padding: "12px 14px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
  },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  heading: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  roleRow: { display: "flex", flexDirection: "column", gap: 2 },
  roleHead: { display: "flex", alignItems: "baseline", gap: 6 },
  roleName: { fontSize: 12, fontWeight: 600, color: "var(--text)" },
  roleHelp: { fontSize: 11, color: "var(--text-muted)" },
  roleBody: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  roleColumn: {
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xs)",
    padding: "1px 6px",
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    borderRadius: "var(--radius-pill)",
    padding: "1px 7px",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  badgeInferred: {
    color: "var(--text-muted)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  badgeConfirmed: {
    color: "var(--accent)",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent-border)",
  },
  badgeUnresolved: {
    color: "var(--danger)",
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  roleWhy: { margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 },
  linkBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    color: "var(--accent)",
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
  },
  options: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 3 },
  optionBtn: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xs)",
    color: "var(--text)",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    padding: "2px 7px",
    cursor: "pointer",
  },
  line: { margin: 0, fontSize: 12, color: "var(--text)" },
  lineMuted: { margin: 0, fontSize: 11, color: "var(--text-muted)" },
  note: { margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 },
  step: { display: "flex", gap: 7, alignItems: "flex-start" },
  stepBody: { display: "flex", flexDirection: "column", gap: 1 },
  stepLabel: { fontSize: 12, fontWeight: 500, color: "var(--text)" },
  stepSkipped: { fontSize: 12, fontWeight: 500, color: "var(--text-muted)" },
  stepDesc: { fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 },
  stepReason: { fontSize: 11, color: "var(--text-soft)", lineHeight: 1.45 },
  icon: { flexShrink: 0, marginTop: 2 },
  spinner: { animation: "spin 1s linear infinite" },
  blocked: {
    display: "flex",
    gap: 7,
    fontSize: 12,
    color: "var(--text)",
    lineHeight: 1.5,
  },
  download: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
  },
};
