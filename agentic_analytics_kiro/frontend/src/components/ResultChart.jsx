import { useCallback, useRef, useState } from "react";
import { formatValue } from "./FindingsBlock.jsx";

/**
 * A chart for a query result, when the result's *shape* supports one.
 *
 * Every decision here is made from column types and row counts — never from a
 * column name (plan §1). Nothing is plotted unless the data genuinely answers
 * the form's question, so a result that isn't chart-shaped simply renders as
 * the table alone rather than being forced into a picture.
 *
 * Deliberately single-series: a second measure on the same plot would need a
 * second y-scale, which invents a correlation the data doesn't contain. Extra
 * measures stay in the table below.
 */

// One value is a stat tile, not a chart; KPI cards already cover that case.
const MIN_POINTS = 2;
// Past this many bars the category axis stops being readable and the table is
// the better form.
const MAX_BARS = 12;
// Bars/lines are drawn in the app's accent, validated against the white bubble
// surface for lightness, chroma and 3:1 contrast (single series, so no
// colour-blindness pair check applies).
const SERIES = "var(--accent)";
const SURFACE = "var(--surface)";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isDateStr = (v) => typeof v === "string" && ISO_DATE.test(v) && !isNaN(Date.parse(v));

function columnKind(rows, col) {
  const vals = rows.map((r) => r[col]).filter((v) => v != null);
  if (!vals.length) return "empty";
  if (vals.every(isNum)) return "number";
  if (vals.every(isDateStr)) return "date";
  return "text";
}

/**
 * Decides which chart — if any — this result supports.
 * `totalRows` matters: /query returns at most 200 rows but reports the true
 * count, and plotting a truncated slice as if it were the whole result would
 * misstate the answer. So a truncated result gets no chart.
 */
export function pickChart(columns, rows, totalRows) {
  if (!columns?.length || !rows?.length) return null;
  if (rows.length < MIN_POINTS) return null;
  if (totalRows != null && totalRows !== rows.length) return null;

  const kinds = Object.fromEntries(columns.map((c) => [c, columnKind(rows, c)]));
  const valueCol = columns.find((c) => kinds[c] === "number");
  if (!valueCol) return null;

  const dateCol = columns.find((c) => kinds[c] === "date");
  const textCol = columns.find((c) => kinds[c] === "text");

  // A date axis is a trend — the strongest reading a result can support.
  if (dateCol) {
    const points = rows
      .map((r) => ({ t: Date.parse(r[dateCol]), label: String(r[dateCol]), value: r[valueCol] }))
      .filter((p) => Number.isFinite(p.t) && isNum(p.value))
      .sort((a, b) => a.t - b.t);
    if (points.length < MIN_POINTS) return null;
    return { kind: "line", labelCol: dateCol, valueCol, points };
  }

  // Otherwise a category axis is a magnitude comparison.
  if (textCol && rows.length <= MAX_BARS) {
    const points = rows
      .filter((r) => isNum(r[valueCol]))
      .map((r) => ({ label: String(r[textCol]), value: r[valueCol] }));
    if (points.length < MIN_POINTS) return null;
    return { kind: "bar", labelCol: textCol, valueCol, points };
  }

  return null;
}

// Axis ticks land on round numbers (0 / 500 / 1,000), never on raw data values.
function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out.filter((v) => v >= min - step / 2);
}

function compact(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return formatValue(v);
}

function shortDate(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Results carry ISO strings; show a date a person can read, and only include
// the time when it isn't midnight (i.e. when it actually carries information).
function fullDate(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  return midnight ? date : `${date}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Measures the plot container.
 *
 * This is a callback ref rather than a mount-once effect on purpose: an
 * assistant message renders first in its loading state, where there are no
 * rows and this component returns null, so the measured node does not exist
 * yet. A mount-once observer would attach to nothing and the chart would stay
 * 0-wide forever once the answer arrived. A callback ref re-attaches whenever
 * the node actually appears.
 */
function useWidth() {
  const [w, setW] = useState(0);
  const obs = useRef(null);
  const ref = useCallback((node) => {
    obs.current?.disconnect();
    if (!node) {
      obs.current = null;
      return;
    }
    setW(node.clientWidth);
    obs.current = new ResizeObserver(([e]) => setW(e.contentRect.width));
    obs.current.observe(node);
  }, []);
  return [ref, w];
}

function Tooltip({ x, y, label, value, width }) {
  // Keep the readout inside the plot rather than letting it spill past the edge.
  const flip = x > width - 120;
  return (
    <div
      style={{
        ...styles.tooltip,
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: y,
      }}
    >
      {/* Value leads, label follows — the reader already knows the series. */}
      <div style={styles.tooltipValue}>{formatValue(value)}</div>
      <div style={styles.tooltipLabel}>{label}</div>
    </div>
  );
}

function LineChart({ points, valueCol, width }) {
  const [hover, setHover] = useState(null);
  const H = 180;
  // The right margin is the end label's own lane — it is never drawn over the
  // series, and the bottom band leaves room for the date axis so the card
  // never needs an inner scrollbar.
  const PAD = { top: 16, right: 52, bottom: 26, left: 48 };
  const pw = Math.max(1, width - PAD.left - PAD.right);
  const ph = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi);
  const yMin = Math.min(lo, ...ticks);
  const yMax = Math.max(hi, ...ticks);

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const sx = (t) => PAD.left + (t1 === t0 ? pw / 2 : ((t - t0) / (t1 - t0)) * pw);
  const sy = (v) => PAD.top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.t)},${sy(p.value)}`).join(" ");
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
  const last = points[points.length - 1];
  // Two labels within ~64px would overlap; the endpoint wins and the peak's
  // value stays reachable via hover and the table.
  const showPeak = peak !== last && Math.abs(sx(peak.t) - sx(last.t)) > 64;

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const near = points.reduce((a, b) =>
      Math.abs(sx(b.t) - px) < Math.abs(sx(a.t) - px) ? b : a
    );
    setHover(near);
  };

  return (
    <div style={styles.plotWrap}>
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${valueCol} over time`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ display: "block", touchAction: "none" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)}
              stroke="var(--border)" strokeWidth="1"
            />
            <text x={PAD.left - 8} y={sy(t) + 3} textAnchor="end" style={styles.tick}>
              {compact(t)}
            </text>
          </g>
        ))}

        <text x={PAD.left} y={H - 8} textAnchor="start" style={styles.tick}>
          {shortDate(t0)}
        </text>
        {t1 !== t0 && pw > 260 && (
          <text x={PAD.left + pw / 2} y={H - 8} textAnchor="middle" style={styles.tick}>
            {shortDate(t0 + (t1 - t0) / 2)}
          </text>
        )}
        {t1 !== t0 && (
          <text x={width - PAD.right} y={H - 8} textAnchor="end" style={styles.tick}>
            {shortDate(t1)}
          </text>
        )}

        <path d={d} fill="none" stroke={SERIES} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />

        {/* Direct labels stay selective: the peak and the endpoint, and the
            peak label is dropped when it would collide with the end label. */}
        {showPeak && (
          <>
            <circle cx={sx(peak.t)} cy={sy(peak.value)} r="4"
                    fill={SERIES} stroke={SURFACE} strokeWidth="2" />
            <text x={sx(peak.t)} y={sy(peak.value) - 9} textAnchor="middle" style={styles.endLabel}>
              {compact(peak.value)}
            </text>
          </>
        )}

        <circle cx={sx(last.t)} cy={sy(last.value)} r="4"
                fill={SERIES} stroke={SURFACE} strokeWidth="2" />
        <text x={sx(last.t) + 9} y={sy(last.value) + 4} textAnchor="start" style={styles.endLabel}>
          {compact(last.value)}
        </text>

        {hover && (
          <g>
            <line x1={sx(hover.t)} x2={sx(hover.t)} y1={PAD.top} y2={PAD.top + ph}
                  stroke="var(--border2)" strokeWidth="1" />
            <circle cx={sx(hover.t)} cy={sy(hover.value)} r="4"
                    fill={SERIES} stroke={SURFACE} strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (
        <Tooltip
          x={sx(hover.t)}
          y={Math.max(0, sy(hover.value) - 46)}
          label={fullDate(hover.t)}
          value={hover.value}
          width={width}
        />
      )}
    </div>
  );
}

function BarChart({ points, valueCol, labelCol, width, onHover }) {
  const [hover, setHover] = useState(null);
  // Horizontal bars fill the card, so a floating tooltip would sit on top of
  // the neighbouring bars' value labels. The readout goes in the caption row
  // instead, where it can't occlude any data.
  const show = (p, y) => { setHover(p ? { ...p, y } : null); onHover?.(p ?? null); };
  // Horizontal bars: category names in SQL results are long and arbitrary, and
  // this reads them without rotating any text.
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const BAND = 28;            // >= 24px so every bar is a comfortable hit target
  const THICK = 18;           // <= 24px cap; the band's leftover is deliberate air
  const labelW = Math.min(120, Math.max(56, ...sorted.map((p) => p.label.length * 6.2)));
  const valueW = 58;
  const PAD = { top: 4, right: valueW, bottom: 4, left: labelW + 10 };
  const H = PAD.top + sorted.length * BAND + PAD.bottom;
  const pw = Math.max(1, width - PAD.left - PAD.right);

  const lo = Math.min(0, ...sorted.map((p) => p.value));
  const hi = Math.max(0, ...sorted.map((p) => p.value));
  const span = hi - lo || 1;
  const zero = PAD.left + ((0 - lo) / span) * pw;
  const sx = (v) => PAD.left + ((v - lo) / span) * pw;

  return (
    <div style={styles.plotWrap}>
      <svg width={width} height={H} role="list"
           aria-label={`${valueCol} by ${labelCol}`} style={{ display: "block" }}>
        {sorted.map((p, i) => {
          const y = PAD.top + i * BAND + (BAND - THICK) / 2;
          const x = Math.min(zero, sx(p.value));
          const w = Math.max(1, Math.abs(sx(p.value) - zero));
          const r = Math.min(4, w);
          const neg = p.value < 0;
          // Rounded at the data end, square at the baseline.
          const d = neg
            ? `M${x + r},${y} h${w - r} v${THICK} h${-(w - r)} a${r},${r} 0 0 1 ${-r},${-r} v${-(THICK - 2 * r)} a${r},${r} 0 0 1 ${r},${-r} z`
            : `M${x},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${THICK - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} z`;
          return (
            <g key={`${p.label}-${i}`}
               tabIndex={0}
               role="listitem"
               aria-label={`${p.label}: ${formatValue(p.value)}`}
               onPointerEnter={() => show(p, y)}
               onPointerLeave={() => show(null)}
               onFocus={() => show(p, y)}
               onBlur={() => show(null)}
               style={{ outline: "none" }}>
              {/* Full-band transparent hit target, wider than the painted bar. */}
              <rect x="0" y={PAD.top + i * BAND} width={width} height={BAND} fill="transparent" />
              <text x={labelW} y={y + THICK / 2 + 4} textAnchor="end" style={styles.catLabel}>
                {truncate(p.label, Math.floor(labelW / 6.2))}
                <title>{p.label}</title>
              </text>
              <path d={d} fill={SERIES} opacity={hover && hover.label !== p.label ? 0.55 : 1} />
              <text x={Math.max(sx(p.value), zero) + 8} y={y + THICK / 2 + 4}
                    textAnchor="start" style={styles.valueLabel}>
                {compact(p.value)}
              </text>
            </g>
          );
        })}
        {lo < 0 && (
          <line x1={zero} x2={zero} y1={PAD.top} y2={H - PAD.bottom}
                stroke="var(--border2)" strokeWidth="1" />
        )}
      </svg>
    </div>
  );
}

export default function ResultChart({ columns, rows, totalRows }) {
  const spec = pickChart(columns, rows, totalRows);
  const [ref, width] = useWidth();
  const [readout, setReadout] = useState(null);

  if (!spec) return null;

  return (
    <div style={styles.card}>
      {/* One series, so the caption names it and no legend box is needed. The
          hovered/focused bar's full name and value ride the same row — the
          axis labels are truncated, so this is where the full name is read. */}
      <div style={styles.captionRow}>
        <span style={styles.caption}>
          {spec.kind === "line"
            ? `${spec.valueCol} over ${spec.labelCol}`
            : `${spec.valueCol} by ${spec.labelCol}`}
        </span>
        {readout && (
          <span style={styles.readout}>
            <strong style={styles.readoutValue}>{formatValue(readout.value)}</strong>
            <span style={styles.readoutLabel}>{readout.label}</span>
          </span>
        )}
      </div>
      <div ref={ref} style={{ width: "100%" }}>
        {width > 80 &&
          (spec.kind === "line" ? (
            <LineChart points={spec.points} valueCol={spec.valueCol} width={width} />
          ) : (
            <BarChart
              points={spec.points}
              valueCol={spec.valueCol}
              labelCol={spec.labelCol}
              width={width}
              onHover={setReadout}
            />
          ))}
      </div>
    </div>
  );
}

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
    // The bubble shrink-wraps its content, so without a floor a two-column
    // result squeezes the plot into ~70px. Never wider than the bubble.
    minWidth: "min(340px, 100%)",
  },
  captionRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 16,
  },
  readout: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
  },
  readoutValue: { fontSize: 12, fontWeight: 600, color: "var(--text)" },
  readoutLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  caption: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  plotWrap: { position: "relative", width: "100%" },
  tick: {
    fontSize: 10,
    fill: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  catLabel: { fontSize: 11, fill: "var(--text-soft)" },
  valueLabel: {
    fontSize: 11,
    fill: "var(--text)",
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  endLabel: { fontSize: 11, fill: "var(--text)", fontWeight: 600 },
  tooltip: {
    position: "absolute",
    pointerEvents: "none",
    background: "var(--surface)",
    border: "1px solid var(--border2)",
    borderRadius: 8,
    padding: "6px 9px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
    whiteSpace: "nowrap",
    zIndex: 2,
  },
  tooltipValue: { fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 },
  tooltipLabel: { fontSize: 11, color: "var(--text-muted)", lineHeight: 1.3 },
};
