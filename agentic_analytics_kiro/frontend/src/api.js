const BASE = "";

export async function createSession() {
  const r = await fetch(`${BASE}/session`, { method: "POST" });
  return r.json();
}

export async function deleteSession(sid) {
  await fetch(`${BASE}/session/${sid}`, { method: "DELETE" });
}

export async function uploadFiles(sid, files) {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const r = await fetch(`${BASE}/session/${sid}/upload`, { method: "POST", body: form });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function runQuery(sid, query) {
  const r = await fetch(`${BASE}/session/${sid}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function exportLast(sid) {
  const r = await fetch(`${BASE}/session/${sid}/export`);
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "export.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
