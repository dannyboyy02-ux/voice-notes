import { DateTime } from "luxon";

export type ResolvedDue = { dueAt: string | null; needsReview: boolean; reason?: string };

const WITH_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A reminder given only a day ("on Friday") alerts at 9:00 that morning. */
export const DEFAULT_HOUR = 9;

/**
 * Turns the wall-clock time Claude wrote ("2026-11-12 09:00", in the speaker's time zone)
 * into an exact instant. Anything unclear gets no alarm and goes to Review.
 */
export function resolveDue(dueLocal: string | null | undefined, timeZone: string, recordingStartedAt: string): ResolvedDue {
  if (!dueLocal) return { dueAt: null, needsReview: true, reason: "no date given" };
  const text = dueLocal.trim();
  let parts: { year: number; month: number; day: number; hour: number; minute: number } | null = null;
  const a = WITH_TIME.exec(text);
  const b = DATE_ONLY.exec(text);
  if (a) parts = { year: +a[1], month: +a[2], day: +a[3], hour: +a[4], minute: +a[5] };
  else if (b) parts = { year: +b[1], month: +b[2], day: +b[3], hour: DEFAULT_HOUR, minute: 0 };
  if (!parts) return { dueAt: null, needsReview: true, reason: "date not in a known format" };

  const local = DateTime.fromObject(parts, { zone: timeZone });
  if (!local.isValid) return { dueAt: null, needsReview: true, reason: "not a real date or time zone" };
  // Luxon shifts a time that does not exist (clocks going forward) instead of failing. Treat it as unclear.
  if (local.hour !== parts.hour || local.minute !== parts.minute) {
    return { dueAt: null, needsReview: true, reason: "that time does not exist on that day" };
  }
  const started = DateTime.fromISO(recordingStartedAt);
  if (started.isValid && local.toMillis() < started.toMillis()) {
    return { dueAt: null, needsReview: true, reason: "date is before the recording" };
  }
  if (started.isValid && local.toMillis() > started.plus({ years: 2 }).toMillis()) {
    return { dueAt: null, needsReview: true, reason: "date is more than two years away" };
  }
  return { dueAt: local.toUTC().toISO(), needsReview: false };
}

/** The anchor Claude is given so "tomorrow at 3" has one meaning. */
export function recordingAnchor(recordingStartedAt: string, timeZone: string): string {
  const dt = DateTime.fromISO(recordingStartedAt, { zone: timeZone });
  const local = dt.isValid ? dt : DateTime.fromISO(recordingStartedAt).toUTC();
  return `${local.toFormat("cccc, d LLLL yyyy, HH:mm")} (${local.zoneName}, UTC${local.toFormat("ZZ")})`;
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
