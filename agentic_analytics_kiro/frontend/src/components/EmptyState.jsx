import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

const ACCEPTED = ".csv,.tsv,.txt,.parquet,.json,.ndjson,.jsonl,.xlsx,.xls,.xlsm,.orc,.avro";

const FORMATS = [
  "CSV", "TSV", "TXT", "Parquet", "JSON", "NDJSON", "JSONL", "ORC", "Avro", "XLSX", "XLS", "XLSM",
];

export default function EmptyState({ onUpload, uploading }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

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

        <div
          style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={28} color="var(--accent)" />
          <span style={styles.dropzoneText}>
            {uploading ? "Uploading…" : "Drop files here or click to browse"}
          </span>
          <span style={styles.formats}>{FORMATS.join(" · ")}</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
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
};
