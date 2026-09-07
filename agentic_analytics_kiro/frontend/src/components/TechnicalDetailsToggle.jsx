import { SlidersHorizontal } from "lucide-react";

/**
 * TechnicalDetailsToggle (plan §8): the thin per-message control that loads
 * this answer's SQL and execution meta into the drawer and opens it.
 *
 * Deliberately last and behind one click — the answer is primary, technical
 * detail is on demand (§6, §7).
 */
export default function TechnicalDetailsToggle({ onOpen }) {
  return (
    <button
      style={styles.button}
      onClick={onOpen}
      title="Show the SQL and execution detail for this answer"
    >
      <SlidersHorizontal size={12} />
      <span>Technical details</span>
    </button>
  );
}

const styles = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 9px",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    alignSelf: "flex-start",
  },
};
