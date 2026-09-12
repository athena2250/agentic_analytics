import { useState, useEffect } from "react";
import { Copy, Check, RotateCcw, Download, SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import SQLView from "../SQLView.jsx";
import ExecutionMeta from "../ExecutionMeta.jsx";

/**
 * Technical Details panel (plan §7/§8), now a right-side Sheet overlay
 * instead of a push-layout column — the chat pane keeps its full width while
 * this is open (an intentional improvement over the previous CodePanel).
 *
 * Composed of SQLView (the editor) and ExecutionMeta (how the answer was
 * produced); this file owns the sheet chrome — header, copy/reset, export —
 * and the SQL draft the user may edit.
 */
export default function CodeSheet({
  sql, meta, open, onOpenChange, onSQLChange, onExport, latestSQL = null,
  // Every query behind one answer, for an event analysis's workbook (plan
  // §17.6). Null on an ordinary turn, where there is only ever one statement
  // and the selector below doesn't render.
  statements = null,
}) {
  const [copied, setCopied] = useState(false);
  const [localSQL, setLocalSQL] = useState(sql);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setLocalSQL(sql);
    setExportError(null);
    setSelected(0);
  }, [sql, statements]);

  const shown = statements?.[selected] ?? null;
  const showSQL = shown ? shown.sql : localSQL;
  const pickStatement = (i) => {
    setSelected(i);
    setLocalSQL(statements[i].sql);
  };

  const copy = () => {
    if (!showSQL) return;
    navigator.clipboard.writeText(showSQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = () => {
    setLocalSQL(sql);
    onSQLChange(sql);
  };

  const doExport = async () => {
    if (!onExport || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport();
    } catch (e) {
      console.error("export failed", e);
      setExportError(e.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const isEmpty = !showSQL?.trim();
  const exportsThisAnswer = Boolean(latestSQL) && sql === latestSQL;
  const edited = !statements && localSQL !== sql;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] gap-0 p-0 sm:w-[420px]">
        <SheetHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3">
          <SlidersHorizontal size={14} className="text-muted-foreground" />
          <SheetTitle className="flex-1 text-sm">Technical details</SheetTitle>
          {!statements && localSQL !== sql && (
            <Button variant="ghost" size="icon" className="size-7" onClick={reset} title="Reset">
              <RotateCcw size={12} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={copy} title="Copy SQL" disabled={isEmpty}>
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          </Button>
        </SheetHeader>

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-5 text-center">
            <SlidersHorizontal size={26} className="text-border" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Open “Technical details” on an answer to inspect its SQL here
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {statements && (
              <div className="flex shrink-0 flex-col gap-1.5 border-b px-4 py-2">
                <div className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  {statements.length} quer{statements.length === 1 ? "y" : "ies"} behind this answer
                </div>
                <div className="flex flex-wrap gap-1">
                  {statements.map((s, i) => (
                    <button
                      key={s.title}
                      onClick={() => pickStatement(i)}
                      title={s.skipped ? `Not included — ${s.skipped}` : `${s.rows} row(s)`}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px]",
                        i === selected
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                        s.skipped && "opacity-60 line-through"
                      )}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                {shown && (
                  <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">
                    {shown.skipped
                      ? `Not included — ${shown.skipped}`
                      : `${shown.rows} row${shown.rows === 1 ? "" : "s"} · ${shown.validation}`}
                  </p>
                )}
              </div>
            )}
            <SQLView
              value={showSQL}
              readOnly={Boolean(statements)}
              onChange={(next) => {
                if (statements) return;
                setLocalSQL(next);
                onSQLChange(next);
              }}
            />
            <ExecutionMeta meta={meta} />
            {onExport && (
              <div className="shrink-0 border-t px-4 py-2">
                <Button
                  className="w-full justify-center gap-1.5"
                  variant="secondary"
                  size="sm"
                  onClick={doExport}
                  disabled={!exportsThisAnswer || exporting}
                  title={
                    exportsThisAnswer
                      ? (statements
                        ? "Download the multi-sheet workbook this analysis produced"
                        : "Download this answer's rows as .xlsx")
                      : "Export returns the most recent answer's rows — open technical details on that answer to export it"
                  }
                >
                  <Download size={12} />
                  {exporting
                    ? "Exporting…"
                    : statements
                      ? "Download the workbook (.xlsx)"
                      : "Export this result (.xlsx)"}
                </Button>
                {!exportsThisAnswer && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    Export returns the most recent answer's rows. Open “Technical
                    details” on that answer to download it.
                  </p>
                )}
                {exportsThisAnswer && edited && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    Your edits above aren't run — the file contains the result of
                    the query that ran.
                  </p>
                )}
                {exportError && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-destructive">{exportError}</p>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
