import { Check, Loader2, AlertCircle } from "lucide-react";

/**
 * Upload progress, driven by the real sequential awaits in App.performUpload —
 * not by timers (plan §6, §10: only show activity that corresponds to actual
 * backend operations).
 *
 * Two steps, because the backend genuinely does two round trips:
 *   POST /upload   — transfers the files and loads them into DuckDB in one call,
 *                    so it is shown as one step rather than split into an
 *                    "Uploading" and "Loading" pair the UI cannot actually observe.
 *   GET  /profile  — computes the column profiles.
 *
 * §6 also sketches a "Semantic labeling" step; no such step exists in the live
 * upload path today, so it is omitted rather than faked.
 */
const STEPS = [
  { key: "uploading", label: "Uploading and loading into DuckDB" },
  { key: "profiling", label: "Profiling columns" },
];

const ORDER = ["uploading", "profiling", "ready"];

export default function UploadProgress({ stage, error, compact = false }) {
  if (!stage) return null;

  const current = ORDER.indexOf(stage);

  return (
    <div style={compact ? styles.rootCompact : styles.root}>
      {STEPS.map((step, i) => {
        const done = current > i;
        const active = current === i;
        return (
          <div key={step.key} style={{ ...styles.row, opacity: done || active ? 1 : 0.45 }}>
            <span style={styles.icon}>
              {done ? (
                <Check size={12} color="var(--accent)" />
              ) : active ? (
                <Loader2 size={12} color="var(--accent)" style={styles.spin} />
              ) : (
                <span style={styles.pending} />
              )}
            </span>
            <span style={{ ...styles.label, fontWeight: active ? 600 : 400 }}>
              {step.label}
            </span>
          </div>
        );
      })}

      {stage === "ready" && (
        <div style={styles.row}>
          <span style={styles.icon}>
            <Check size={12} color="var(--accent)" />
          </span>
          <span style={{ ...styles.label, fontWeight: 600 }}>Ready</span>
        </div>
      )}

      {error && (
        <div style={styles.row}>
          <span style={styles.icon}>
            <AlertCircle size={12} color="#d9534f" />
          </span>
          <span style={{ ...styles.label, color: "#d9534f" }}>{error}</span>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
    padding: "14px 16px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    textAlign: "left",
  },
  rootCompact: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "8px 2px 2px",
    textAlign: "left",
  },
  row: { display: "flex", alignItems: "center", gap: 8 },
  icon: {
    width: 12,
    height: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pending: { width: 6, height: 6, borderRadius: "50%", border: "1px solid var(--border2)" },
  label: { fontSize: 12, color: "var(--text-soft)", lineHeight: 1.4 },
  spin: { animation: "spin 0.9s linear infinite" },
};
