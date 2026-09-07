const BASE = "";

export async function getFormats() {
  const r = await fetch(`${BASE}/formats`);
  if (!r.ok) throw new Error(await r.text());
  const { formats } = await r.json();
  return formats;
}

export async function createSession() {
  const r = await fetch(`${BASE}/session`, { method: "POST" });
  return r.json();
}

export async function uploadFiles(sid, files) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const r = await fetch(`${BASE}/session/${sid}/upload`, { method: "POST", body: form });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/**
 * Asks one question (plan §10): POSTs it to the streaming endpoint and parses
 * the SSE frames the backend emits as each real step completes, calling
 * `onEvent(name, payload)` for each one. Resolves with the RESPONSE_READY
 * payload — the same object the blocking `POST /query` returns, which the UI
 * no longer calls since every turn wants the steps.
 *
 * EventSource can't be used here: it only issues GET requests, and the question
 * travels in the body. fetch + a stream reader is the equivalent for POST.
 */
export async function runQueryStream(sid, query, onEvent, roles = null) {
  const r = await fetch(`${BASE}/session/${sid}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `roles` pins one or more of an event analysis's resolved roles (plan
    // §17.2). Omitted on every other turn, so the backend infers as before.
    body: JSON.stringify(roles ? { query, roles } : { query }),
  });
  if (!r.ok) throw new Error(await r.text());
  if (!r.body) throw new Error("Streaming is not supported by this browser.");

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let response = null;

  // Frames are separated by a blank line; a chunk can split one anywhere, so
  // only complete frames are parsed and the remainder stays in the buffer.
  const drain = (flush = false) => {
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
    if (flush && buffer.trim()) handleFrame(buffer);
  };

  const handleFrame = (frame) => {
    let event = "message";
    const data = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    if (event === "ERROR") throw new Error(payload.detail || "Query failed.");
    if (event === "RESPONSE_READY") response = payload.response;
    onEvent?.(event, payload);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
  }
  buffer += decoder.decode();
  drain(true);

  // The connection closed before the turn finished — a dropped stream, not an
  // answer. Reported as a failure rather than as an empty result.
  if (!response) throw new Error("The connection closed before the answer arrived.");
  return response;
}

export async function getProfile(sid) {
  const r = await fetch(`${BASE}/session/${sid}/profile`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/**
 * Candidate joins between the session's tables (plan §16). Returns [] for a
 * single-table session — an empty list is the real answer there, not a
 * failure, so callers render "no relationships" rather than an error.
 */
export async function getRelationships(sid) {
  const r = await fetch(`${BASE}/session/${sid}/relationships`);
  if (!r.ok) throw new Error(await r.text());
  const { relationships } = await r.json();
  return relationships;
}

/**
 * Downloads the session's most recent export. For an ordinary turn that is the
 * single sheet of rows the answer showed; after an event analysis it is the
 * multi-sheet workbook the backend already assembled (plan §17.6), which is why
 * the filename comes from the response rather than being assumed here.
 */
export async function exportLast(sid) {
  const r = await fetch(`${BASE}/session/${sid}/export`);
  if (!r.ok) throw new Error(await r.text());
  const disposition = r.headers.get("content-disposition") || "";
  const named = /filename=\"?([^\";]+)/.exec(disposition);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = named ? named[1] : "export.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
