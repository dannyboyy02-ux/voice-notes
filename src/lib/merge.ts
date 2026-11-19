/**
 * Merging conversations: putting two or more recordings together as one, in order, with the join made
 * correctly. Pure functions only, so every rule here is unit-tested and the server recomputes the same
 * plan the preview showed.
 *
 * The join between two recordings is one of:
 * - a gap: the second began after the first ended (back-to-back pieces, or a meeting split in two);
 * - an overlap: both captured the same moments (the seam between two parts of a long recording, or the
 *   same meeting recorded twice, say by another app and this one). Lines heard in both are kept once.
 *
 * Overlaps are found from the words themselves, not only the clocks: an imported file carries the
 * file's date, which is often when it was exported rather than when the meeting happened.
 */
import { sameTask } from "./items";

export type MergeLine = { speaker: string; start_ms: number; end_ms: number; text: string };

/** One audio piece of a conversation: which recording's file, where it sits in the merged timeline, and which stretch of it is used. */
export type AudioPiece = {
  recording_id: string;
  title: string | null;
  started_at: string;
  /** Merged time at which this file's own time 0 falls. */
  offset_ms: number;
  /** The stretch of the file that is used, in the file's own time. */
  from_ms: number;
  to_ms: number;
  /** How this piece joins the one before it. */
  seam: Seam;
};

export type MergeSource = {
  id: string;
  title: string | null;
  started_at: string;
  duration_ms: number | null;
  lines: MergeLine[];
  /** Set when the source is itself a merged conversation: its own audio pieces. */
  pieces?: AudioPiece[] | null;
  /** For each line of a merged source, which of its pieces it came from. */
  lineSegments?: number[] | null;
};

export type Seam =
  | { kind: "first" }
  | { kind: "gap"; gap_ms: number | null }
  | { kind: "overlap"; overlap_ms: number; dropped: number; contained: boolean; by: "words" | "clock" };

export type PlanSpeaker = { label: string; as: string; samples: string[] };

export type PlanSegment = {
  id: string;
  title: string | null;
  started_at: string;
  duration_ms: number;
  offset_ms: number;
  /** The stretch of this recording kept in the merge, in its own time. */
  from_ms: number;
  to_ms: number;
  seam: Seam;
  kept: number;
  speakers: PlanSpeaker[];
};

export type PlannedLine = MergeLine & { segment: number };

export type MergePlan = {
  order: string[];
  segments: PlanSegment[];
  /** The merged transcript, in order, in merged time. `segment` indexes `pieces`. */
  lines: PlannedLine[];
  pieces: AudioPiece[];
  duration_ms: number;
  speakers: number;
  warnings: string[];
};

/** "sourceId:label" → the label it takes in the merge (an earlier recording's speaker it is the same person as). */
export type SpeakerMatches = Record<string, string>;

const NGRAM = 5;
/**
 * Words of the second transcript that must be matched, all agreeing on the same time shift, before two
 * recordings count as overlapping: about two sentences. A stock phrase ("thanks everyone, see you next
 * week") said in two separate meetings stays below it; the short overlap where part 1 and part 2 of one
 * recording meet is caught by the clock instead.
 */
const MIN_WORDS = 24;
const BIN_MS = 2000;
/** A clock-only overlap this short is the seam between two parts of one recording, not two recordings of one meeting. */
const CLOCK_SEAM_MS = 10_000;

export const MAX_MERGE = 10;

const words = (text: string) =>
  text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/'/g, "").split(/\s+/).filter(Boolean);

/** Every word with an estimated time: lines carry only a start and end, so words are spread evenly across them. */
function timedWords(lines: MergeLine[]): { w: string; t: number }[] {
  const out: { w: string; t: number }[] = [];
  for (const l of lines) {
    const ws = words(l.text);
    const span = Math.max(0, l.end_ms - l.start_ms);
    ws.forEach((w, i) => out.push({ w, t: l.start_ms + (ws.length ? (span * i) / ws.length : 0) }));
  }
  return out;
}

/**
 * Whether the second transcript repeats part of the first, and if so the time shift between them:
 * a moment at time t in the second is the moment at time t + shift_ms in the first.
 * Runs of five words in a row are matched, and the shifts they imply are counted; a real overlap
 * gives many matches agreeing on one shift, where a stock phrase said twice gives a scattered few.
 */
export function findOverlap(a: MergeLine[], b: MergeLine[]): { shift_ms: number; matches: number } | null {
  const wa = timedWords(a);
  const wb = timedWords(b);
  if (wa.length < NGRAM || wb.length < NGRAM) return null;
  const index = new Map<string, number[]>();
  for (let i = 0; i + NGRAM <= wa.length; i++) {
    const key = wa.slice(i, i + NGRAM).map((x) => x.w).join(" ");
    const list = index.get(key);
    if (list) list.push(wa[i].t);
    else index.set(key, [wa[i].t]);
  }
  const bins = new Map<number, { shift: number; j: number }[]>();
  for (let j = 0; j + NGRAM <= wb.length; j++) {
    const hits = index.get(wb.slice(j, j + NGRAM).map((x) => x.w).join(" "));
    if (!hits) continue;
    for (const ta of hits) {
      const shift = ta - wb[j].t;
      const bin = Math.round(shift / BIN_MS);
      const list = bins.get(bin);
      if (list) list.push({ shift, j });
      else bins.set(bin, [{ shift, j }]);
    }
  }
  let best: { shift: number; j: number }[] = [];
  let bestWords = 0;
  for (const [bin, list] of bins) {
    // Neighbouring bins count too: estimated word times are rough.
    const near = [...list, ...(bins.get(bin - 1) ?? []), ...(bins.get(bin + 1) ?? [])];
    const covered = new Set<number>();
    for (const m of near) for (let k = 0; k < NGRAM; k++) covered.add(m.j + k);
    if (covered.size > bestWords) { best = near; bestWords = covered.size; }
  }
  if (bestWords < MIN_WORDS) return null;
  const sorted = best.map((m) => m.shift).sort((x, y) => x - y);
  return { shift_ms: Math.round(sorted[Math.floor(sorted.length / 2)]), matches: bestWords };
}

const endOf = (s: { duration_ms: number | null; lines: MergeLine[] }) =>
  Math.max(s.duration_ms ?? 0, ...s.lines.map((l) => l.end_ms), 0);

/** Speaker labels in the order they first speak. */
const labelsOf = (lines: MergeLine[]) => [...new Set(lines.map((l) => l.speaker))];

function nextLabel(taken: Set<string>): string {
  for (let i = 0; ; i++) {
    const label = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`;
    if (!taken.has(label)) return label;
  }
}

type Working = { src: MergeSource; offset: number; from: number; to: number; lines: MergeLine[]; lineSegs: number[] | null; seam: Seam };

/**
 * Plans a merge. `order` is the owner's order when given; otherwise recordings go in the order they began.
 * Each recording is joined to the one before it.
 */
export function planMerge(sources: MergeSource[], options: { order?: string[]; speakers?: SpeakerMatches } = {}): MergePlan {
  if (sources.length < 2) throw new Error("Pick at least two conversations to merge.");
  if (sources.length > MAX_MERGE) throw new Error(`At most ${MAX_MERGE} conversations can be merged at once.`);
  const byId = new Map(sources.map((s) => [s.id, s]));
  if (byId.size !== sources.length) throw new Error("The same conversation was picked twice.");
  const warnings: string[] = [];

  let order: string[];
  if (options.order?.length) {
    if (options.order.length !== sources.length || options.order.some((id) => !byId.has(id)) || new Set(options.order).size !== sources.length) {
      throw new Error("The order does not match the conversations picked.");
    }
    order = [...options.order];
  } else {
    order = [...sources].sort((x, y) => x.started_at.localeCompare(y.started_at)).map((s) => s.id);
    // The words can show that two recordings were made the other way round from what their dates say
    // (an imported file dated when it was exported). Neighbours are swapped until they agree.
    for (let pass = 0; pass < sources.length; pass++) {
      let swapped = false;
      for (let i = 0; i + 1 < order.length; i++) {
        const found = findOverlap(byId.get(order[i])!.lines, byId.get(order[i + 1])!.lines);
        if (found && found.shift_ms < 0) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
          swapped = true;
        }
      }
      if (!swapped) break;
    }
  }

  const work: Working[] = [];
  for (const [n, id] of order.entries()) {
    const src = byId.get(id)!;
    const w: Working = { src, offset: 0, from: 0, to: endOf(src), lines: [...src.lines], lineSegs: src.lineSegments ? [...src.lineSegments] : null, seam: { kind: "first" } };
    if (n > 0) {
      const prev = work[n - 1];
      const prevEnd = prev.lines.length ? Math.max(...prev.lines.map((l) => l.end_ms)) : prev.to;
      const clockShift = Date.parse(src.started_at) - Date.parse(prev.src.started_at);
      const prevClockEnd = endOf(prev.src);
      const byWords = findOverlap(prev.lines, src.lines);
      let shift: number | null = null;
      let by: "words" | "clock" = "words";
      if (byWords && byWords.shift_ms >= 0 && byWords.shift_ms < prevEnd) {
        shift = byWords.shift_ms;
      } else if (byWords && byWords.shift_ms < 0) {
        warnings.push(`"${src.title ?? "Untitled recording"}" seems to begin before "${prev.src.title ?? "Untitled recording"}". Move it up if so; for now it is placed after.`);
      } else if (Number.isFinite(clockShift) && clockShift < prevClockEnd && clockShift >= 0) {
        const overlapMs = prevClockEnd - clockShift;
        if (overlapMs <= CLOCK_SEAM_MS) {
          shift = clockShift;
          by = "clock";
        } else {
          warnings.push(`By their clocks "${src.title ?? "Untitled recording"}" overlaps the one before it by ${Math.round(overlapMs / 60000) || "under 1"} min, but no words are shared, so it is placed after it.`);
        }
      }

      if (shift === null) {
        w.offset = prev.offset + prev.to;
        const gap = Number.isFinite(clockShift) ? clockShift - prevClockEnd : NaN;
        w.seam = { kind: "gap", gap_ms: Number.isFinite(gap) ? Math.max(0, gap) : null };
      } else {
        // The cut: from the first line of this recording that runs on past the end of the previous one.
        // Everything before it is already in the previous recording; the previous one stops where it starts.
        const k = src.lines.findIndex((l) => l.end_ms + shift! > prevEnd + 1500);
        const before = w.lines.length;
        if (k === -1) {
          w.lines = [];
          w.lineSegs = w.lineSegs ? [] : null;
          w.from = w.to;
        } else {
          const cut = src.lines[k].start_ms + shift;
          w.lines = src.lines.slice(k);
          w.lineSegs = w.lineSegs ? w.lineSegs.slice(k) : null;
          w.from = src.lines[k].start_ms;
          const keep = prev.lines.findIndex((l) => l.start_ms >= cut);
          if (keep !== -1) {
            prev.lines = prev.lines.slice(0, keep);
            if (prev.lineSegs) prev.lineSegs = prev.lineSegs.slice(0, keep);
            prev.to = Math.min(prev.to, cut);
          }
        }
        w.offset = prev.offset + shift;
        w.seam = { kind: "overlap", overlap_ms: Math.max(0, prevEnd - shift), dropped: before - w.lines.length, contained: k === -1, by };
        if (k === -1) warnings.push(`Everything in "${src.title ?? "Untitled recording"}" is already in the one before it, so it adds nothing to the transcript.`);
      }
    }
    work.push(w);
  }

  // Speakers. The first recording keeps its letters; later ones take new letters unless the owner matched them.
  const matches = options.speakers ?? {};
  const final = new Set<string>();
  const segments: PlanSegment[] = [];
  const maps: Map<string, string>[] = [];
  for (const [n, w] of work.entries()) {
    const map = new Map<string, string>();
    const known = new Set(final);
    for (const label of labelsOf(w.src.lines)) {
      const wanted = n > 0 ? matches[`${w.src.id}:${label}`] : undefined;
      let as: string;
      if (n === 0) as = label;
      else if (wanted && known.has(wanted) && ![...map.values()].includes(wanted)) as = wanted;
      else as = nextLabel(new Set([...final, ...map.values()]));
      map.set(label, as);
    }
    for (const v of map.values()) final.add(v);
    maps.push(map);
    segments.push({
      id: w.src.id, title: w.src.title, started_at: w.src.started_at, duration_ms: endOf(w.src),
      offset_ms: w.offset, from_ms: w.from, to_ms: w.to, seam: w.seam, kept: w.lines.length,
      speakers: [...map.entries()].map(([label, as]) => ({
        label, as,
        samples: w.src.lines.filter((l) => l.speaker === label).slice(0, 2).map((l) => (l.text.length > 140 ? `${l.text.slice(0, 137)}…` : l.text)),
      })),
    });
  }

  // Audio pieces. A source that is itself a merge brings its own pieces, clipped to the stretch kept.
  const pieces: AudioPiece[] = [];
  const pieceStart: number[] = [];
  for (const w of work) {
    pieceStart.push(pieces.length);
    if (w.src.pieces?.length) {
      w.src.pieces.forEach((p, i) => {
        const from = Math.max(p.from_ms, w.from - p.offset_ms);
        const to = Math.min(p.to_ms, w.to - p.offset_ms);
        // The first piece of an earlier merge joins the recording before it the way the whole merge does.
        pieces.push({ ...p, offset_ms: w.offset + p.offset_ms, from_ms: from, to_ms: Math.max(from, to), seam: i === 0 ? w.seam : p.seam });
      });
    } else {
      pieces.push({ recording_id: w.src.id, title: w.src.title, started_at: w.src.started_at, offset_ms: w.offset, from_ms: w.from, to_ms: w.to, seam: w.seam });
    }
  }

  const lines: PlannedLine[] = [];
  work.forEach((w, n) => {
    w.lines.forEach((l, i) => {
      const inner = w.src.pieces?.length && w.lineSegs ? Math.min(w.lineSegs[i] ?? 0, w.src.pieces.length - 1) : 0;
      lines.push({ speaker: maps[n].get(l.speaker) ?? l.speaker, start_ms: l.start_ms + w.offset, end_ms: l.end_ms + w.offset, text: l.text, segment: pieceStart[n] + inner });
    });
  });
  lines.sort((x, y) => x.start_ms - y.start_ms || x.segment - y.segment);

  return {
    order,
    segments,
    lines,
    pieces,
    duration_ms: Math.max(...work.map((w) => w.offset + w.to)),
    speakers: final.size,
    warnings,
  };
}

export type MergeItem = {
  id: string; recording_id: string; type: "todo" | "reminder"; text: string; at_ms: number | null;
  state: "suggested" | "active" | "done" | "dismissed";
};

const STATE_RANK = { done: 3, active: 2, dismissed: 1, suggested: 0 } as const;

/**
 * The items each original had, placed on the merged timeline. A task that was picked up from more than one
 * recording is kept once: the copy you have acted on most (done, then active) wins.
 */
export function mergeItems<T extends MergeItem>(items: T[], plan: MergePlan): T[] {
  const offset = new Map(plan.segments.map((s) => [s.id, s.offset_ms]));
  const chosen: T[] = [];
  const ordered = [...items].sort((x, y) => plan.order.indexOf(x.recording_id) - plan.order.indexOf(y.recording_id));
  for (const item of ordered) {
    if (!offset.has(item.recording_id)) continue;
    const placed = { ...item, at_ms: item.at_ms === null ? null : item.at_ms + offset.get(item.recording_id)! };
    const twin = chosen.findIndex((c) => c.type === placed.type && sameTask(c.text, placed.text));
    if (twin === -1) chosen.push(placed);
    else if (STATE_RANK[placed.state] > STATE_RANK[chosen[twin].state]) chosen[twin] = placed;
  }
  return chosen;
}

/** A gap in plain words: "12 min", "23 h 42 m", "3 days". */
export function gapText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes / 60} h`;
  return `${Math.round(minutes / 1440)} days`;
}

/** The line shown in the transcript, and given to Claude, where one recording ends and the next begins. */
export function seamText(pieces: AudioPiece[], index: number, when: (iso: string) => string): string {
  const p = pieces[index];
  if (!p) return "";
  const head = `Recording ${index + 1} of ${pieces.length}${p.title ? `: ${p.title}` : ""} · began ${when(p.started_at)}`;
  const seam = index === 0 ? ({ kind: "first" } as Seam) : p.seam;
  if (seam.kind === "first") return head;
  if (seam.kind === "gap") {
    if (seam.gap_ms === null) return head;
    const min = Math.round(seam.gap_ms / 60000);
    return `${head} · ${min < 1 ? "straight after" : `${gapText(min)} after`} recording ${index} ended`;
  }
  return `${head} · overlaps recording ${index}; lines heard in both are kept once`;
}

/** Reads the audio pieces saved on a merged conversation, refusing anything malformed. */
export function readPieces(value: unknown): AudioPiece[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const ok = value.every((p) => p && typeof p === "object" && typeof p.recording_id === "string" && typeof p.offset_ms === "number"
    && typeof p.from_ms === "number" && typeof p.to_ms === "number" && typeof p.started_at === "string" && p.seam && typeof p.seam.kind === "string");
  return ok ? (value as AudioPiece[]) : null;
}

/** Marks the first line of each recording in a merged transcript with its divider text, for Claude and Zeus to read. */
export function withHeadings<T extends { segment?: number | null }>(lines: T[], pieces: AudioPiece[] | null, when: (iso: string) => string): (T & { heading?: string })[] {
  if (!pieces?.length) return lines;
  let last = -1;
  return lines.map((l) => {
    const seg = l.segment ?? 0;
    if (seg === last) return l;
    last = seg;
    return { ...l, heading: seamText(pieces, seg, when) };
  });
}
