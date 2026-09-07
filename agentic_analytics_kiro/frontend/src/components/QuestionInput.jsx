import { useEffect, useRef } from "react";
import { Send } from "lucide-react";

/**
 * QuestionInput (plan §8): the question box at the foot of the conversation.
 *
 * A controlled input — the value lives in the conversation panel so a
 * suggestion chip can fill it — with auto-grow and Enter-to-send here.
 */
export default function QuestionInput({ value, onChange, onSend, disabled, hasData }) {
  const textareaRef = useRef();

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  const canSend = Boolean(value.trim()) && !disabled;

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div style={styles.inputArea}>
      <div style={styles.inputBox}>
        <textarea
          ref={textareaRef}
          style={styles.textarea}
          placeholder={hasData ? "What would you like to investigate?" : "Upload data first, then ask questions…"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          disabled={disabled}
        />
        <button
          style={{ ...styles.sendBtn, ...(canSend ? {} : styles.sendDisabled) }}
          onClick={onSend}
          disabled={!canSend}
          title="Send"
        >
          <Send size={14} />
        </button>
      </div>
      <p style={styles.hint}>Enter to send · Shift+Enter for new line</p>
    </div>
  );
}

const styles = {
  inputArea: {
    padding: "12px 20px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
  },
  inputBox: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "8px 8px 8px 14px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  textarea: {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: "var(--text)",
    fontSize: 14,
    lineHeight: 1.6,
    resize: "none",
    maxHeight: 160,
    overflowY: "auto",
  },
  sendBtn: {
    background: "var(--accent)",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "opacity 0.15s",
  },
  sendDisabled: { opacity: 0.3, cursor: "not-allowed" },
  hint: { fontSize: 11, color: "var(--text-muted)", marginTop: 5, textAlign: "center" },
};
