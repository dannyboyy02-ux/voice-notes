import { z } from "zod";

export const ExtractedItem = z.object({
  type: z.enum(["todo", "reminder"]),
  text: z.string().describe("Short action in the imperative, e.g. 'Email Sam the property survey'."),
  due_local: z
    .string()
    .nullable()
    .describe("For reminders: 'YYYY-MM-DD HH:mm' or 'YYYY-MM-DD' in the speaker's time zone. null when no date was said or it is unclear."),
  said: z.string().nullable().describe("The date words as spoken, e.g. 'Thursday morning'. null if none."),
  quote: z.string().nullable().describe("The words from the transcript this item came from."),
  at_ms: z.number().nullable().describe("Start time in milliseconds of the utterance it came from."),
  needs_review: z.boolean().describe("true when the item or its date is uncertain."),
});

export const Extraction = z.object({
  title: z.string().describe("A plain title of at most 8 words."),
  summary: z.string().describe("Two or three sentences on what was said and decided."),
  confidence: z.enum(["high", "low"]).describe("low if the transcript was hard to follow or you may have missed commitments."),
  items: z.array(ExtractedItem),
});

export type ExtractionResult = z.infer<typeof Extraction>;
export type ExtractedItemResult = z.infer<typeof ExtractedItem>;
