"use client";
/** On-phone storage for recordings in progress. Audio stays here until the upload is confirmed. */

export type LocalState = "recording" | "stopped" | "uploading" | "uploaded";
export type LocalSession = {
  id: string; // also the id of the recording row on the server
  userId: string;
  startedAt: string;
  timeZone: string;
  mimeType: string;
  part: number;
  bytes: number;
  chunks: number;
  lastChunkAt: number;
  durationMs: number | null;
  state: LocalState;
  note?: string;
  /** Set when a file is imported from inside a folder: the recording is filed there once uploaded. */
  folderId?: string;
};

const DB = "voice-notes";
let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("sessions", { keyPath: "id" });
      req.result.createObjectStore("chunks", { keyPath: ["sessionId", "seq"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putSession(s: LocalSession): Promise<void> {
  const tx = (await open()).transaction("sessions", "readwrite");
  tx.objectStore("sessions").put(s);
  await txDone(tx);
}
export async function getSession(id: string): Promise<LocalSession | undefined> {
  return done((await open()).transaction("sessions").objectStore("sessions").get(id));
}
export async function listSessions(): Promise<LocalSession[]> {
  const all = await done<LocalSession[]>((await open()).transaction("sessions").objectStore("sessions").getAll());
  return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export async function patchSession(id: string, patch: Partial<LocalSession>): Promise<LocalSession | undefined> {
  const tx = (await open()).transaction("sessions", "readwrite");
  const store = tx.objectStore("sessions");
  const cur = await done<LocalSession | undefined>(store.get(id));
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  store.put(next);
  await txDone(tx);
  return next;
}

/** Writes one chunk and updates the session's totals in the same transaction. */
export async function putChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
  const tx = (await open()).transaction(["sessions", "chunks"], "readwrite");
  tx.objectStore("chunks").put({ sessionId, seq, blob });
  const sessions = tx.objectStore("sessions");
  const cur = await done<LocalSession | undefined>(sessions.get(sessionId));
  if (cur) sessions.put({ ...cur, bytes: cur.bytes + blob.size, chunks: cur.chunks + 1, lastChunkAt: Date.now() });
  await txDone(tx);
}
/** Chunks after the first are not playable alone, so they are always joined in order. */
export async function joinChunks(sessionId: string, mimeType: string): Promise<Blob> {
  const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
  const rows = await done<{ seq: number; blob: Blob }[]>((await open()).transaction("chunks").objectStore("chunks").getAll(range));
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(rows.map((r) => r.blob), { type: mimeType });
}
export async function deleteSession(sessionId: string): Promise<void> {
  const tx = (await open()).transaction(["sessions", "chunks"], "readwrite");
  tx.objectStore("chunks").delete(IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
  tx.objectStore("sessions").delete(sessionId);
  await txDone(tx);
}
