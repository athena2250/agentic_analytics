import { Loader2, Check } from "lucide-react";

/**
 * ActivityTrace (plan §8, §10): what the assistant is doing right now.
 *
 * The hard constraint from §10 is *"only show activity that corresponds to
 * actual backend operations."* Today `/query` is one blocking call, so the
 * honest render is one labeled step — not animated dots implying a sequence
 * that isn't running.
 *
 * The component is already shaped for the streaming event model in §10: when
 * the backend gains a real agent loop and emits steps (SQL_GENERATED,
 * QUERY_EXECUTED, INVESTIGATION_STEP …), pass them as `steps` and the same
 * component renders the list. Nothing here enumerates step kinds — a step is
 * whatever label the backend sent, so dataset-dependent investigations need no
 * UI change (§1).
 */
const FALLBACK_LABEL = "Generating and validating query…";

export default function ActivityTrace({ steps, label }) {
  // Multi-step trace: only reachable once the backend actually emits steps.
  if (steps?.length) {
    return (
      <div style={styles.trace}>
        {steps.map((step, i) => {
          const done = step.done ?? i < steps.length - 1;
          return (
            <div key={step.id ?? `${step.label}-${i}`} style={styles.step}>
              {done
                ? <Check size={12} color="var(--accent)" style={styles.icon} />
                : <Loader2 size={12} style={{ ...styles.icon, ...styles.spinner }} />}
              <span style={done ? styles.stepDone : styles.stepActive}>{step.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // Single blocking call — one honest label.
  return (
    <div style={styles.single}>
      <Loader2 size={13} style={styles.spinner} />
      <span>{label ?? FALLBACK_LABEL}</span>
    </div>
  );
}

const styles = {
  single: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "2px 0",
    fontSize: 13,
    color: "var(--text-muted)",
  },
  trace: { display: "flex", flexDirection: "column", gap: 4, padding: "2px 0" },
  step: { display: "flex", alignItems: "center", gap: 7, fontSize: 13 },
  icon: { flexShrink: 0 },
  spinner: { animation: "spin 1s linear infinite", flexShrink: 0 },
  stepActive: { color: "var(--text-muted)" },
  stepDone: { color: "var(--text-soft)" },
};
