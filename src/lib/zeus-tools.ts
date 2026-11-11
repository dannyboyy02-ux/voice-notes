import { z } from "zod";

/** What Zeus may do to to-dos and reminders. Kept free of server imports so it can be tested. */
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "not an item id");
const text = z.string().trim().min(1).max(300);
const dueLocal = z.string().trim().min(1).max(40).nullable();

export const AddItemInput = z.object({ type: z.enum(["todo", "reminder"]), text, due_local: dueLocal.optional() }).strict();
export const UpdateItemInput = z
  .object({ id, text: text.optional(), due_local: dueLocal.optional(), state: z.enum(["active", "done"]).optional() })
  .strict()
  .refine((v) => v.text !== undefined || v.due_local !== undefined || v.state !== undefined, "nothing to change");
export const RemoveItemInput = z.object({ id }).strict();

const DUE_HELP = 'Local wall-clock time as "YYYY-MM-DD HH:mm" (24-hour) or "YYYY-MM-DD" in the owner\'s time zone.';

export const ZEUS_TOOLS = [
  {
    name: "add_item",
    description: "Add a new to-do or reminder for the owner. Use only when the owner asks you to in the chat.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["todo", "reminder"], description: "reminder if it has a date or time, otherwise todo" },
        text: { type: "string", description: "Short action in the imperative" },
        due_local: { type: ["string", "null"], description: `${DUE_HELP} Omit or null for no date.` },
      },
      required: ["type", "text"],
    },
  },
  {
    name: "update_item",
    description: "Change an existing item: its wording, its due time, or mark it done or active again. Use the id shown next to the item.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The item's id" },
        text: { type: "string", description: "New wording" },
        due_local: { type: ["string", "null"], description: `${DUE_HELP} null removes the date.` },
        state: { type: "string", enum: ["active", "done"] },
      },
      required: ["id"],
    },
  },
  {
    name: "remove_item",
    description: "Remove an item from the owner's lists. Use the id shown next to the item.",
    input_schema: { type: "object" as const, properties: { id: { type: "string", description: "The item's id" } }, required: ["id"] },
  },
];

export type ToolName = "add_item" | "update_item" | "remove_item";
export const TOOL_INPUTS = { add_item: AddItemInput, update_item: UpdateItemInput, remove_item: RemoveItemInput } as const;
