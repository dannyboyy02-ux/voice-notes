"use client";
import * as tus from "tus-js-client";
import { accessToken, api, getConfig, getSupabase } from "../client/supabase";
import { extensionFor } from "./mime";
import { deleteSession, getSession, joinChunks, patchSession, type LocalSession } from "./store";

/** Supabase resumable uploads take pieces of exactly 6 MB. */
export const UPLOAD_PIECE_BYTES = 6 * 1024 * 1024;

export function storagePath(s: Pick<LocalSession, "userId" | "id" | "mimeType">): string {
  return `${s.userId}/${s.id}.${extensionFor(s.mimeType)}`;
}

/**
 * Uploads one finished recording straight to Supabase Storage in resumable pieces,
 * saves its row as "uploaded", and only then removes the audio from the phone.
 * Safe to call again after any failure: the upload resumes and the row is not duplicated.
 */
export async function uploadSession(id: string, onProgress: (fraction: number) => void): Promise<void> {
  const s = await getSession(id);
  if (!s) return;
  if (s.state === "recording") throw new Error("Still recording");
  await patchSession(id, { state: "uploading" });
  try {
    const [cfg, token, file] = await Promise.all([getConfig(), accessToken(), joinChunks(id, s.mimeType)]);
    if (!file.size) throw new Error("This recording is empty.");
    const path = storagePath(s);

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${cfg.supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${token}`, apikey: cfg.supabaseAnonKey!, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: "audio", objectName: path, contentType: s.mimeType, cacheControl: "3600" },
        chunkSize: UPLOAD_PIECE_BYTES,
        onError: (err) => reject(err),
        onProgress: (sent, total) => onProgress(total ? sent / total : 0),
        onSuccess: () => resolve(),
      });
      // If an earlier attempt got part-way, carry on from where it stopped.
      upload.findPreviousUploads().then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }, reject);
    });

    const db = await getSupabase();
    const row = {
      id: s.id, user_id: s.userId, started_at: s.startedAt, time_zone: s.timeZone, duration_ms: s.durationMs,
      storage_path: path, mime_type: s.mimeType, bytes: file.size, part: s.part, status: "uploaded",
      ...(s.folderId ? { folder_id: s.folderId } : {}),
    };
    // ignoreDuplicates: a repeat must not push a recording that is already being processed back to "uploaded".
    let { error } = await db.from("recordings").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    // The folder it was imported into may have been deleted meanwhile: the recording is kept, unfiled.
    if (error && s.folderId) ({ error } = await db.from("recordings").upsert({ ...row, folder_id: null }, { onConflict: "id", ignoreDuplicates: true }));
    if (error) throw new Error(error.message);
    const { data: saved, error: readError } = await db.from("recordings").select("id").eq("id", s.id).maybeSingle();
    if (readError || !saved) throw new Error(readError?.message ?? "The server did not confirm the recording.");

    // Confirmed on the server. Only now is it safe to drop the audio from the phone.
    await deleteSession(id);
    // Tell the server now, so transcription starts at once instead of at the scheduler's next minute.
    // If this call fails, the scheduler still picks the recording up.
    void api("/api/kick").catch(() => {});
  } catch (err) {
    await patchSession(id, { state: "stopped", note: `Upload did not finish: ${(err as Error).message}` });
    throw err;
  }
}
