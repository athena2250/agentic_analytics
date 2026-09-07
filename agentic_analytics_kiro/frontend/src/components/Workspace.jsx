import { useCallback, useState } from "react";
import ChatWindow from "./ChatWindow.jsx";
import CodePanel from "./CodePanel.jsx";
import DatasetReadyBanner from "./DatasetReadyBanner.jsx";
import { exportLast } from "../api.js";

/**
 * Workspace view (plan §7/§8): what the app shows once the active session
 * holds a dataset — the "Dataset ready" banner, the conversation panel, and
 * the technical details drawer, which is collapsed by default and opened
 * per-message.
 *
 * Drawer state lives here, not in App, because it belongs to one session's
 * conversation: App keys this component by session id, so switching sessions
 * drops the previous session's SQL rather than carrying it across (§13.10).
 */
export default function Workspace({ session, onUpdate }) {
  const [sql, setSQL] = useState("");
  const [meta, setMeta] = useState(null);
  const [open, setOpen] = useState(false);

  const openTechnical = useCallback((nextSQL, nextMeta, shouldOpen = true) => {
    setSQL(nextSQL ?? "");
    setMeta(nextMeta ?? null);
    if (shouldOpen) setOpen(true);
  }, []);

  return (
    <>
      <div style={styles.conversation}>
        {/* Announces the profile once per load, above the conversation rather
            than inside it: the numbers describe the dataset as it stands now,
            so they don't belong to any one past message (§8). */}
        <DatasetReadyBanner profile={session.profile} name={session.name} />
        <ChatWindow session={session} onUpdate={onUpdate} onOpenTechnical={openTechnical} />
      </div>

      <CodePanel
        sql={sql}
        meta={meta}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        onSQLChange={setSQL}
        onExport={() => exportLast(session.id)}
      />
    </>
  );
}

const styles = {
  conversation: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderLeft: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
  },
};
