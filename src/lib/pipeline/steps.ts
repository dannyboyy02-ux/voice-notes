/**
 * The server-side life of a recording:
 *   uploaded > transcribing > transcribed > extracting > ready   (or failed, with Retry)
 * The database function claim_recording() does the atomic part; this file is the same
 * rule in plain code so it can be tested and reused by the worker.
 */
export type Status = "uploaded" | "transcribing" | "transcribed" | "extracting" | "ready" | "failed";
export type WorkStep = "transcribing" | "extracting";

export const MAX_ATTEMPTS = 3;
export const LOCK_MS = 6 * 60 * 1000;

export type Claimable = {
  status: Status;
  attempts: number;
  locked_until: string | null;
  aai_transcript_id?: string | null;
};

const ENTRY: Record<WorkStep, Status> = { transcribing: "uploaded", extracting: "transcribed" };
const DONE: Record<WorkStep, Status> = { transcribing: "transcribed", extracting: "ready" };

/** Which step a worker may claim for this recording right now, if any. */
export function claimTarget(r: Claimable, now: Date): WorkStep | null {
  if (r.attempts >= MAX_ATTEMPTS) return null;
  if (r.status === "uploaded") return "transcribing";
  if (r.status === "transcribed") return "extracting";
  const lockExpired = r.locked_until !== null && new Date(r.locked_until).getTime() < now.getTime();
  if (r.status === "extracting" && lockExpired) return "extracting";
  // A transcription that already has a job id is waiting on the speech service, not crashed.
  if (r.status === "transcribing" && !r.aai_transcript_id && lockExpired) return "transcribing";
  return null;
}

/** The row changes a successful claim makes. */
export function applyClaim(r: Claimable, now: Date): (Claimable & { status: WorkStep }) | null {
  const step = claimTarget(r, now);
  if (!step) return null;
  return { ...r, status: step, attempts: r.attempts + 1, locked_until: new Date(now.getTime() + LOCK_MS).toISOString() };
}

/** A finished step moves on and starts the next step with a clean retry count. */
export function onStepSuccess(step: WorkStep): { status: Status; attempts: 0; locked_until: null; last_error: null } {
  return { status: DONE[step], attempts: 0, locked_until: null, last_error: null };
}

/** A failed step goes back to its starting point until the third failure, then stops as failed. */
export function onStepFailure(
  step: WorkStep,
  attempts: number,
  error: string,
): { status: Status; failed_step: WorkStep | null; locked_until: null; last_error: string } {
  const last_error = error.slice(0, 500);
  if (attempts >= MAX_ATTEMPTS) return { status: "failed", failed_step: step, locked_until: null, last_error };
  return { status: ENTRY[step], failed_step: null, locked_until: null, last_error };
}

/** What the Retry button does to a failed recording. */
export function retryPatch(failedStep: WorkStep | null, hasTranscript: boolean) {
  const step: WorkStep = failedStep ?? (hasTranscript ? "extracting" : "transcribing");
  return { status: ENTRY[step], failed_step: null, attempts: 0, locked_until: null, last_error: null } as const;
}

/** What "Redo with best model" does: run extraction again on the best model. */
export function redoPatch() {
  return { status: "transcribed", failed_step: null, attempts: 0, locked_until: null, last_error: null, model_override: "best" } as const;
}

export const STATUS_LABEL: Record<Status, string> = {
  uploaded: "Uploaded, waiting",
  transcribing: "Transcribing",
  transcribed: "Transcribed, waiting",
  extracting: "Finding to-dos",
  ready: "Ready",
  failed: "Failed",
};
