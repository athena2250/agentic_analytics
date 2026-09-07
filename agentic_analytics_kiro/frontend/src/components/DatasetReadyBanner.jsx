import { useEffect, useState } from "react";
import { X } from "lucide-react";
import DatasetSummaryCard from "./DatasetSummaryCard.jsx";

/**
 * DatasetReadyBanner (plan §8): the "Dataset ready" summary, shown once per
 * load at the top of the workspace — the §6 hand-off from loading to asking.
 *
 * It lives here rather than inside a chat message because it reports the
 * session's *current* profile, not a snapshot of one upload: an older
 * in-conversation copy would silently restate today's numbers as if they were
 * that upload's. Keyed on the profile the banner is describing, so a second
 * upload (which re-profiles) brings it back with the new totals, while
 * dismissing it keeps it dismissed for that profile.
 *
 * Renders nothing when profiling produced no summary — a failed profile means
 * no banner, never a banner full of zeroes (§1).
 */
export default function DatasetReadyBanner({ profile, name }) {
  const [dismissed, setDismissed] = useState(false);

  // A new profile object means new numbers to announce.
  useEffect(() => { setDismissed(false); }, [profile]);

  // Keyed on the summary because that is what the card renders: the banner
  // appears as soon as the upload response carries one (plan §9.4), and stays
  // away entirely when profiling produced none.
  if (!profile?.summary || dismissed) return null;

  return (
    <div style={styles.banner}>
      <div style={styles.card}>
        <DatasetSummaryCard profile={profile} name={name} variant="full" />
      </div>
      <button style={styles.dismiss} onClick={() => setDismissed(true)} title="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}

const styles = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "12px 28px 0",
    flexShrink: 0,
  },
  card: { flex: 1, minWidth: 0 },
  dismiss: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    padding: 4,
    borderRadius: "var(--radius-xs)",
    cursor: "pointer",
    flexShrink: 0,
    marginTop: 2,
  },
};
