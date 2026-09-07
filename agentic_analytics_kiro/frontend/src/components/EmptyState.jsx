import UploadDropzone from "./UploadDropzone.jsx";
import UploadProgress from "./UploadProgress.jsx";

/**
 * EmptyState (plan §8): the first-launch view, shown while the active session
 * holds no tables. Upload-first — there is nothing to ask about yet.
 *
 * The dropzone itself (and its format list, which comes from GET /formats
 * rather than a hardcoded list, §6) is UploadDropzone's; this component owns
 * the framing copy and swaps in real per-request progress while a load runs.
 */
export default function EmptyState({ onUpload, uploadStage, uploadError, formats }) {
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
          <UploadDropzone onUpload={onUpload} formats={formats} />
        )}

        {!uploadStage && uploadError && <p style={styles.error}>{uploadError}</p>}
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
  error: { fontSize: 12, color: "#d9534f", marginTop: 12, lineHeight: 1.5 },
};
