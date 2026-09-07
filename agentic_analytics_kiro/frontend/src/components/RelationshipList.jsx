import { useState } from "react";
import { ChevronDown, ChevronRight, Link2 } from "lucide-react";

/**
 * RelationshipList (plan §16): how the datasets in this session connect.
 *
 * A session can hold several files, and questions can span them — but only
 * where the tables actually share values. Each row here is a *candidate* join
 * the backend measured (GET /session/{id}/relationships), shown with the
 * evidence behind it: how many values the two columns share, and what share of
 * the smaller side that is. Nothing is presented as a declared foreign key,
 * because nothing declared one.
 *
 * Rendered only for a session with more than one table: on a single-table
 * session an empty list isn't a finding, it's a category that doesn't apply.
 */
export default function RelationshipList({ relationships, tableCount = 0 }) {
  const [open, setOpen] = useState(false);
  if (!relationships || tableCount < 2) return null;

  return (
    <div style={styles.section}>
      <button style={styles.sectionHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={styles.sectionTitle}>Relationships</span>
        <span style={styles.count}>{relationships.length}</span>
      </button>

      {open && (
        <div style={styles.body}>
          {relationships.length === 0 ? (
            <div style={styles.empty}>
              No shared values were found between these tables, so questions
              spanning them can't be joined — they can still be compared over
              time by asking how one affects the other.
            </div>
          ) : (
            relationships.map((r, i) => (
              <div key={i} style={styles.row}>
                <Link2 size={12} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={styles.detail}>
                  <div style={styles.pair}>
                    {r.left_table}.{r.left_column} = {r.right_table}.{r.right_column}
                  </div>
                  <div style={styles.evidence}>
                    {r.kind} · {r.matched_values.toLocaleString()} shared values
                    {" · "}{Math.round(r.overlap * 100)}% of the smaller side
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  section: { borderBottom: "1px solid var(--border)" },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "10px 14px",
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
    textAlign: "left",
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  count: { marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" },
  body: { padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", gap: 7, alignItems: "flex-start" },
  detail: { minWidth: 0 },
  pair: { fontSize: 12, color: "var(--text)", wordBreak: "break-word" },
  evidence: { fontSize: 11, color: "var(--text-muted)", marginTop: 1 },
  empty: { fontSize: 11, color: "var(--text-soft)", lineHeight: 1.6 },
};
