/**
 * Inline-style fragments used by more than one component.
 *
 * The design tokens themselves live in index.css (§12); this only holds
 * compound fragments that were being retyped identically in several files —
 * where a copy drifting silently changes how one block looks next to another.
 * Spread it and override what differs: `{ ...sectionLabel, color: "..." }`.
 */

/** The small uppercase caption above a result block (Forecast, Anomalies, …). */
export const sectionLabel = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

/** A vertical stack of a label and its content. */
export const section = { display: "flex", flexDirection: "column", gap: 5 };

/** The bordered column that fills the space between the two side panels. */
export const centerColumn = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderLeft: "1px solid var(--border)",
  borderRight: "1px solid var(--border)",
};
