import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import UploadProgress from "./UploadProgress.jsx";

// `formats` comes from GET /formats, which derives it from loader.py's reader
// tables (plan §6) — nothing here is hardcoded. While it is null the format
// line is omitted rather than guessed at.
export default function EmptyState({ onUpload, uploadStage, uploadError, formats }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();
  const accepted = formats?.map((f) => `.${f}`).join(",");

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    onUpload(Array.from(e.dataTransfer.files));
  };

  const handleBrowse = (e) => {
    onUpload(Array.from(e.target.files));
    e.target.value = "";
  };

  return (
    <div style={styles.root}>
      <div style={styles.content}>
        <h1 style={styles.headline}>Bring your data. Start analyzing.</h1>
        <p style={styles.subhead}>
          Upload any file below — no schema, template, or setup required.
        </p>

        {uploadStage ? (
          <UploadProgress stage={uploadStage} error={uploadError} />
        ) : (
          <div
            style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud size={28} color="var(--accent)" />
            <span style={styles.dropzoneText}>Drop files here or click to browse</span>
            {formats?.length > 0 && (
              <span style={styles.formats}>
                {formats.map((f) => f.toUpperCase()).join(" · ")}
              </span>
            )}
          </div>
        )}

        {!uploadStage && uploadError && (
          <p style={styles.error}>{uploadError}</p>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          {...(accepted ? { accept: accepted } : {})}
          style={{ display: "none" }}
          onChange={handleBrowse}
        />
      </div>
    </div>
  );
}

const styles = {
  root: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--bg)",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    maxWidth: 440,
    textAlign: "center",
    padding: "0 24px",
  },
  headline: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.3px",
    margin: "0 0 8px",
  },
  subhead: {
    fontSize: 14,
    color: "var(--text-soft)",
    margin: "0 0 28px",
    lineHeight: 1.5,
  },
  dropzone: {
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
  dropzoneActive: {
    background: "rgba(124,106,247,0.04)",
    borderColor: "var(--accent)",
  },
  dropzoneText: { fontSize: 13, color: "var(--text)", fontWeight: 500 },
  formats: { fontSize: 11, color: "var(--text-muted)" },
  error: { fontSize: 12, color: "#d9534f", marginTop: 12, lineHeight: 1.5 },
};
