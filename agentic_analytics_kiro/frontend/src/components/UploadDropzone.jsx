import { useCallback, useRef, useState } from "react";
import { Upload, UploadCloud } from "lucide-react";

/**
 * UploadDropzone (plan §8): the upload/drag-drop logic, extracted from the
 * Sidebar so the sidebar, the empty state, and anything added later share one
 * implementation instead of three near-copies.
 *
 * `formats` comes from GET /formats (derived from loader.py's readers), so the
 * file picker can never advertise a format the backend would reject (§6).
 * While it is null the format line is omitted rather than guessed at.
 */

// Accept string for <input accept=…>; undefined while formats are unknown, so
// the picker stays permissive rather than filtering against an invented list.
export function acceptAttr(formats) {
  return formats?.length ? formats.map((f) => `.${f}`).join(",") : undefined;
}

/**
 * The file picker half, for callers that own their own trigger button (the
 * sidebar's header "+" and its "Add to this dataset" row). Returns the hidden
 * input element to render and an `open()` to call from any control.
 */
export function useFilePicker(onUpload, formats, enabled = true) {
  const inputRef = useRef();
  const accepted = acceptAttr(formats);

  const open = useCallback(() => {
    if (enabled) inputRef.current?.click();
  }, [enabled]);

  const handleBrowse = (e) => {
    const files = Array.from(e.target.files);
    // Reset first: picking the same file twice in a row must still fire.
    e.target.value = "";
    if (enabled && files.length) onUpload(files);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      {...(accepted ? { accept: accepted } : {})}
      style={{ display: "none" }}
      onChange={handleBrowse}
    />
  );

  return { open, input };
}

/**
 * The drop-target half, for callers that make a whole region droppable without
 * drawing a dropzone (the sidebar tints its entire panel while dragging).
 */
export function useDropTarget(onUpload, enabled = true) {
  const [dragging, setDragging] = useState(false);

  const handlers = {
    onDragOver: (e) => { e.preventDefault(); if (enabled) setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      if (!enabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onUpload(files);
    },
  };

  return { dragging, handlers };
}

/**
 * The visible dropzone. `variant="full"` is the first-run target in
 * EmptyState; `variant="compact"` is the sidebar's smaller drop hint.
 */
export default function UploadDropzone({
  onUpload,
  formats,
  disabled = false,
  variant = "full",
  label,
}) {
  const { open, input } = useFilePicker(onUpload, formats, !disabled);
  const { dragging, handlers } = useDropTarget(onUpload, !disabled);
  const compact = variant === "compact";

  return (
    <>
      <div
        style={{
          ...(compact ? styles.compact : styles.full),
          ...(dragging ? styles.active : {}),
          ...(disabled ? styles.disabled : {}),
        }}
        onClick={open}
        {...handlers}
      >
        {compact ? (
          <Upload size={14} color="var(--text-muted)" />
        ) : (
          <UploadCloud size={28} color="var(--accent)" />
        )}
        <span style={compact ? styles.compactText : styles.fullText}>
          {label ?? (compact ? "Drop files or click to upload" : "Drop files here or click to browse")}
        </span>
        {!compact && formats?.length > 0 && (
          <span style={styles.formats}>
            {formats.map((f) => f.toUpperCase()).join(" · ")}
          </span>
        )}
      </div>
      {input}
    </>
  );
}

const styles = {
  full: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    padding: "36px 24px",
    border: "1.5px dashed var(--border2)",
    borderRadius: 14,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
    background: "var(--surface)",
  },
  compact: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    padding: "14px 8px",
    border: "1.5px dashed var(--border2)",
    borderRadius: 8,
    cursor: "pointer",
    margin: "4px 0",
    transition: "background 0.15s, border-color 0.15s",
  },
  active: {
    background: "rgba(124,106,247,0.04)",
    borderColor: "var(--accent)",
  },
  disabled: { opacity: 0.5, cursor: "not-allowed" },
  fullText: { fontSize: 13, color: "var(--text)", fontWeight: 500 },
  compactText: { fontSize: 11, color: "var(--text-muted)", textAlign: "center" },
  formats: { fontSize: 11, color: "var(--text-muted)" },
};
