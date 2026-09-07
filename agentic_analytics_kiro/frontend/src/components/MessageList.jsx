import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble.jsx";
import SuggestedQuestions from "./SuggestedQuestions.jsx";

/**
 * MessageList (plan §8): the scrolling conversation — message bubbles plus the
 * schema-derived suggestion chips that stand in for a first question.
 *
 * Extracted from ChatWindow so the conversation panel owns turn-taking and
 * this owns rendering + scroll position.
 */
export default function MessageList({
  messages,
  profile,
  hasData,
  onOpenTechnical,
  onRetry,
  canRetry,
  onPickSuggestion,
}) {
  const bottomRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Suggestions stand in for the first question. The upload result is itself a
  // message, so the gate is "no user turn yet", not "no messages".
  const showSuggestions = hasData && !messages.some((m) => m.role === "user");

  return (
    <div style={styles.messages}>
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          onOpenTechnical={onOpenTechnical}
          onRetry={onRetry}
          canRetry={canRetry}
        />
      ))}

      {showSuggestions && (
        <SuggestedQuestions
          profile={profile}
          onPick={onPickSuggestion}
          disabled={!canRetry}
        />
      )}

      <div ref={bottomRef} style={{ height: 1 }} />
    </div>
  );
}

const styles = {
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
};
