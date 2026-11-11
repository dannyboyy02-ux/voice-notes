import { describe, expect, it } from "vitest";
import { AddItemInput, RemoveItemInput, UpdateItemInput, ZEUS_TOOLS } from "./zeus-tools";

const ID = "8518c476-0cb4-404b-b0a0-c340955943bd";

describe("Zeus tool inputs", () => {
  it("accepts a to-do with no date and a reminder with one", () => {
    expect(AddItemInput.safeParse({ type: "todo", text: "Buy filters" }).success).toBe(true);
    expect(AddItemInput.safeParse({ type: "reminder", text: "Call Sam", due_local: "2026-11-12 09:00" }).success).toBe(true);
  });
  it("rejects blank text, unknown types and extra fields", () => {
    expect(AddItemInput.safeParse({ type: "todo", text: "   " }).success).toBe(false);
    expect(AddItemInput.safeParse({ type: "note", text: "x" }).success).toBe(false);
    expect(AddItemInput.safeParse({ type: "todo", text: "x", user_id: "someone-else" }).success).toBe(false);
  });
  it("rejects a cut-off input, as a truncated stream would produce", () => {
    expect(AddItemInput.safeParse({ type: "todo" }).success).toBe(false);
    expect(UpdateItemInput.safeParse({ id: ID.slice(0, 20), state: "done" }).success).toBe(false);
  });
  it("needs a real item id and at least one change to update", () => {
    expect(UpdateItemInput.safeParse({ id: ID, state: "done" }).success).toBe(true);
    expect(UpdateItemInput.safeParse({ id: ID, due_local: null }).success).toBe(true);
    expect(UpdateItemInput.safeParse({ id: ID }).success).toBe(false);
    expect(UpdateItemInput.safeParse({ id: "the first one", state: "done" }).success).toBe(false);
  });
  it("only lets items be marked active or done, never moved to another state", () => {
    expect(UpdateItemInput.safeParse({ id: ID, state: "dismissed" }).success).toBe(false);
  });
  it("removes by id only", () => {
    expect(RemoveItemInput.safeParse({ id: ID }).success).toBe(true);
    expect(RemoveItemInput.safeParse({ id: ID, all: true }).success).toBe(false);
  });
  it("offers exactly three tools, all about items", () => {
    expect(ZEUS_TOOLS.map((t) => t.name)).toEqual(["add_item", "update_item", "remove_item"]);
  });
});
