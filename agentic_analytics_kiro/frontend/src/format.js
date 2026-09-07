/**
 * Display formatting shared across the result views.
 *
 * These lived as near-identical private helpers in FindingsBlock, ResultChart,
 * ResultTable, AnomalyBlock, ForecastBlock and DatasetSummaryCard, which meant
 * the same number could be rendered differently depending on which block drew
 * it. They are locale-grouping only: no unit, currency or scaling is inferred
 * from a column name (plan §1) — the value is whatever the backend measured.
 */

/** Locale grouping at a fixed maximum precision. Non-numbers pass through. */
export function formatNumber(v, maxDigits = 2) {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString(undefined, { maximumFractionDigits: maxDigits })
    : String(v);
}

/**
 * Precision chosen by magnitude: whole numbers and large values read better
 * without decimals, small ones need them to say anything at all. Used wherever
 * a measured value is shown on its own — KPIs, chart tooltips, axis readouts.
 */
export function formatValue(v) {
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (Number.isInteger(v)) return v.toLocaleString();
  if (abs >= 1000) return formatNumber(v, 0);
  if (abs >= 1) return formatNumber(v, 2);
  return formatNumber(v, 4);
}

/** Whole counts — rows, columns, distinct values. */
export const formatCount = (n) => formatNumber(n, 0);
