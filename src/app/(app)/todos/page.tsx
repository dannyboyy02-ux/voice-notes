"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { APPLE_MAX_ITEMS, appleRemindersLink } from "@/lib/apple";
import { localIso, when } from "@/lib/format";
import { ITEM_COLUMNS, type Item } from "@/lib/types";

function Row({ item, pill, onToggle, children }: { item: Item; pill?: React.ReactNode; onToggle: (i: Item) => void; children?: React.ReactNode }) {
  return (
    <div className="item" data-testid="item">
      <input type="checkbox" checked={item.state === "done"} onChange={() => onToggle(item)} aria-label={`Done: ${item.text}`} />
      <div style={{ flex: 1 }}>
        <div style={item.state === "done" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
          {item.text} {pill}
          {item.apple_sent_at && <span className="pill ok" style={{ marginLeft: 6 }}>In Apple Reminders</span>}
        </div>
        {item.recording_id && (
          <Link className="small muted" href={`/notes/${item.recording_id}${item.at_ms !== null ? `?t=${item.at_ms}` : ""}`}>
            {item.quote ? `“${item.quote.slice(0, 90)}”` : "From a recording"}
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}

export default function TodosPage() {
  const { db, refreshOverdue } = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  const [apple, setApple] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [newText, setNewText] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data }, { data: settings }] = await Promise.all([
      db.from("items").select(ITEM_COLUMNS).eq("is_test", false).in("state", ["suggested", "active", "done"]).order("created_at", { ascending: false }).limit(300),
      db.from("settings").select("apple_reminders").maybeSingle(),
    ]);
    setItems((data as Item[]) ?? []);
    setApple(settings?.apple_reminders ?? false);
    refreshOverdue();
  }, [db, refreshOverdue]);
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const patch = async (ids: string[], values: Partial<Item>) => {
    setItems((list) => list?.map((i) => (ids.includes(i.id) ? { ...i, ...values } : i)) ?? null);
    await db.from("items").update(values).in("id", ids);
    refreshOverdue();
  };
  const toggle = (i: Item) => patch([i.id], { state: i.state === "done" ? "active" : "done" });

  if (!items) return <p className="muted">Loading…</p>;
  const nowMs = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const active = items.filter((i) => i.state === "active");
  const dated = active.filter((i) => i.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const overdue = dated.filter((i) => new Date(i.due_at!).getTime() < nowMs);
  const today = dated.filter((i) => { const t = new Date(i.due_at!).getTime(); return t >= nowMs && t <= endOfToday.getTime(); });
  const upcoming = dated.filter((i) => new Date(i.due_at!).getTime() > endOfToday.getTime());
  const undated = active.filter((i) => !i.due_at);
  const review = items.filter((i) => i.state === "suggested");
  const doneItems = items.filter((i) => i.state === "done").slice(0, 15);
  const forApple = active.filter((i) => !i.apple_sent_at).slice(0, APPLE_MAX_ITEMS);

  const sendToApple = async () => {
    const batch = forApple;
    const link = appleRemindersLink(batch.map((i) => ({ title: i.text, due: i.due_at ? localIso(i.due_at) : undefined, notes: i.quote ?? undefined })));
    // The app cannot see whether the Shortcut worked, so items are marked sent and can be undone.
    await patch(batch.map((i) => i.id), { apple_sent_at: new Date().toISOString() });
    setSent(batch.map((i) => i.id));
    window.location.href = link;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    await db.from("items").insert({ type: "todo", text: newText.trim(), state: "active" });
    setNewText("");
    await load();
  };

  const section = (title: string, list: Item[], pill: (i: Item) => React.ReactNode) =>
    list.length > 0 && (
      <section className="card">
        <div className="label">{title}</div>
        {list.map((i) => <Row key={i.id} item={i} onToggle={toggle} pill={pill(i)} />)}
      </section>
    );

  return (
    <>
      <h1>To-dos</h1>
      {sent.length > 0 && (
        <div className="banner ok" data-testid="apple-undo">
          <span>Sent {sent.length} to Apple Reminders.</span>
          <button className="btn small" onClick={async () => { await patch(sent, { apple_sent_at: null }); setSent([]); }}>Undo</button>
        </div>
      )}
      {section("Overdue", overdue, (i) => <span className="pill rec">{when(i.due_at!)}</span>)}
      {section("Today", today, (i) => <span className="pill">{when(i.due_at!)}</span>)}
      {section("Upcoming", upcoming, (i) => <span className="pill">{when(i.due_at!)}</span>)}
      {section("To do", undated, () => null)}

      {review.length > 0 && (
        <section className="card">
          <div className="label">Needs a look</div>
          <p className="small muted">These were unclear, so they have no alarm. Add a date if you want one.</p>
          {review.map((i) => (
            <div className="item" key={i.id} data-testid="review-item">
              <div style={{ flex: 1 }}>
                <div>{i.text} {i.said && <span className="pill warn">“{i.said}”</span>}</div>
                {i.type === "reminder" && (
                  <input className="input" type="datetime-local" style={{ marginTop: 6 }} value={dates[i.id] ?? ""} onChange={(e) => setDates((d) => ({ ...d, [i.id]: e.target.value }))} aria-label="Reminder time" />
                )}
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn small" onClick={() => patch([i.id], { state: "active", needs_review: false, due_at: dates[i.id] ? new Date(dates[i.id]).toISOString() : null })}>Keep</button>
                  <button className="btn small secondary" onClick={() => patch([i.id], { state: "dismissed" })}>Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {apple && forApple.length > 0 && (
        <>
          <button className="btn" onClick={sendToApple} data-testid="apple-send">Send {forApple.length} to Apple Reminders</button>
          <p className="small muted" style={{ textAlign: "center" }}>Opens your Shortcut. One tap per batch of up to {APPLE_MAX_ITEMS}.</p>
        </>
      )}

      <form className="row" onSubmit={add}>
        <input className="input" placeholder="Add a to-do" value={newText} onChange={(e) => setNewText(e.target.value)} />
        <button className="btn">Add</button>
      </form>

      {section("Done", doneItems, () => null)}
      {active.length + review.length + doneItems.length === 0 && <p className="muted">Nothing yet. Record something and its to-dos will appear here.</p>}
    </>
  );
}
