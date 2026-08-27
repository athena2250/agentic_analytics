import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const PAGE = 20;

export default function ResultTable({ columns, rows, totalRows }) {
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : rows;

  const paged = sorted.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(sorted.length / PAGE);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
    setPage(0);
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} style={styles.th} onClick={() => toggleSort(col)}>
                  <span style={styles.thInner}>
                    {col}
                    {sortCol === col
                      ? sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                      : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i} style={i % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                {columns.map((col) => (
                  <td key={col} style={styles.td}>{fmt(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.footer}>
        <span style={styles.count}>
          {(totalRows ?? rows.length).toLocaleString()} row{totalRows !== 1 ? "s" : ""}
          {totalRows > rows.length ? ` · showing first ${rows.length}` : ""}
        </span>
        {pages > 1 && (
          <div style={styles.pagination}>
            <button style={styles.pageBtn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span style={styles.pageInfo}>{page + 1} / {pages}</span>
            <button style={styles.pageBtn} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(v) {
  if (v === null || v === undefined) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  return String(v);
}

const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 6 },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: {
    padding: "7px 11px",
    textAlign: "left",
    background: "var(--surface2)",
    color: "var(--text-muted)",
    fontWeight: 600,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  thInner: { display: "flex", alignItems: "center", gap: 3 },
  rowEven: { background: "var(--surface)" },
  rowOdd: { background: "var(--bg)" },
  td: {
    padding: "6px 11px",
    color: "var(--text)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  count: {},
  pagination: { display: "flex", alignItems: "center", gap: 5 },
  pageBtn: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 4,
    padding: "1px 7px",
    fontSize: 13,
    cursor: "pointer",
  },
  pageInfo: { fontSize: 11 },
};
