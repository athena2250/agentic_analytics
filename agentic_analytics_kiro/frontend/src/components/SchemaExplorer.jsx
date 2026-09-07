import { useState } from "react";
import {
  ChevronDown, ChevronRight, Calendar, Hash, Tag, Key, HelpCircle,
} from "lucide-react";

/**
 * Collapsible schema explorer (plan §7/§8): every column the profile reports,
 * grouped by its detected role — never by a hardcoded column name.
 *
 * Roles and confidences come straight from GET /session/{sid}/profile
 * (loader.py's `_classify_column`). Columns the backend could not confidently
 * label are shown as such rather than filed under a guessed role (§1).
 */

// Render order, not a schema assumption — a dataset may have none of these.
const ROLES = [
  { key: "date", label: "Dates", icon: Calendar },
  { key: "measure", label: "Measures", icon: Hash },
  { key: "dimension", label: "Dimensions", icon: Tag },
  { key: "identifier", label: "Identifiers", icon: Key },
  { key: "unknown", label: "Unlabeled", icon: HelpCircle },
];

const LOW_CONFIDENCE = 0.6;

function groupByRole(profile) {
  const groups = Object.fromEntries(ROLES.map((r) => [r.key, []]));
  const tables = Object.entries(profile?.tables ?? {});
  for (const [tname, table] of tables) {
    for (const col of table.columns ?? []) {
      const bucket = groups[col.role] ? col.role : "unknown";
      groups[bucket].push({ ...col, table: tname });
    }
  }
  return { groups, multiTable: tables.length > 1 };
}

function columnTitle(col, multiTable) {
  const parts = [multiTable ? `${col.table}.${col.name}` : col.name, col.dtype];
  if (col.distinct_count != null) parts.push(`${col.distinct_count.toLocaleString()} distinct`);
  if (col.null_pct != null) parts.push(`${col.null_pct}% null`);
  if (col.samples?.length) parts.push(`e.g. ${col.samples.map(String).join(", ")}`);
  return parts.join(" · ");
}

export default function SchemaExplorer({ profile }) {
  const [open, setOpen] = useState(false);
  const [openRoles, setOpenRoles] = useState({});

  if (!profile) return null;
  const { groups, multiTable } = groupByRole(profile);
  const present = ROLES.filter((r) => groups[r.key].length > 0);
  if (!present.length) return null;

  const total = present.reduce((n, r) => n + groups[r.key].length, 0);

  return (
    <div style={styles.section}>
      <button style={styles.sectionHeader} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span style={styles.sectionTitle}>Schema</span>
        <span style={styles.count}>{total}</span>
      </button>

      {open && (
        <div style={styles.body}>
          {present.map(({ key, label, icon: Icon }) => {
            const cols = groups[key];
            const roleOpen = openRoles[key] ?? true;
            return (
              <div key={key}>
                <button
                  style={styles.roleHeader}
                  onClick={() => setOpenRoles((prev) => ({ ...prev, [key]: !roleOpen }))}
                >
                  {roleOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <Icon size={11} color={key === "unknown" ? "var(--text-muted)" : "var(--accent)"} />
                  <span style={styles.roleLabel}>{label}</span>
                  <span style={styles.count}>{cols.length}</span>
                </button>

                {roleOpen && cols.map((col) => (
                  <div
                    key={`${col.table}.${col.name}`}
                    style={styles.colRow}
                    title={columnTitle(col, multiTable)}
                  >
                    <span style={styles.colName}>{col.name}</span>
                    <span style={styles.colType}>{col.dtype}</span>
                    {col.confidence < LOW_CONFIDENCE && (
                      <span style={styles.uncertain} title="Role inferred with low confidence">?</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {multiTable && (
            <div style={styles.note}>
              Columns are listed across {Object.keys(profile.tables).length} tables — hover a column for its table.
            </div>
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
    gap: 5,
    width: "100%",
    background: "none",
    border: "none",
    padding: "8px 12px",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    cursor: "pointer",
    userSelect: "none",
  },
  sectionTitle: { flex: 1, textAlign: "left" },
  count: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "var(--surface2)",
    borderRadius: 999,
    padding: "1px 6px",
  },
  body: {
    padding: "0 8px 8px",
    maxHeight: 260,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  roleHeader: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    width: "100%",
    background: "none",
    border: "none",
    padding: "4px 4px",
    color: "var(--text-soft)",
    fontSize: 11,
    cursor: "pointer",
    userSelect: "none",
  },
  roleLabel: { flex: 1, textAlign: "left" },
  colRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 6px 3px 22px",
    borderRadius: 5,
    cursor: "default",
  },
  colName: {
    flex: 1,
    fontSize: 11.5,
    color: "var(--text)",
    fontFamily: "var(--mono)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  colType: { fontSize: 9.5, color: "var(--text-muted)", flexShrink: 0 },
  uncertain: {
    fontSize: 9.5,
    color: "var(--text-muted)",
    border: "1px solid var(--border2)",
    borderRadius: 999,
    width: 13,
    height: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  note: {
    fontSize: 10,
    color: "var(--text-muted)",
    padding: "6px 4px 0",
    lineHeight: 1.4,
  },
};
