/**
 * SQLView (plan §8): the editable SQL surface inside the technical details
 * drawer — the existing editor, lifted out of CodePanel unchanged.
 *
 * Labeled with its dialect because the SQL is DuckDB's, and editable because
 * the generated query is a starting point the user is allowed to correct.
 */
export default function SQLView({ value, onChange }) {
  return (
    <>
      <div style={styles.label}>SQL · DuckDB dialect · editable</div>
      <textarea
        style={styles.editor}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </>
  );
}

const styles = {
  label: {
    padding: "8px 14px 4px",
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    flexShrink: 0,
  },
  editor: {
    flex: 1,
    minHeight: 120,
    background: "var(--surface2)",
    border: "none",
    outline: "none",
    resize: "none",
    padding: "12px 14px",
    fontSize: 12,
    fontFamily: "var(--mono)",
    color: "var(--text)",
    lineHeight: 1.7,
    overflowY: "auto",
  },
};
