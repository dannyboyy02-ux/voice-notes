"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import HomeHeader from "@/components/HomeHeader";
import { APPLE_MAX_ITEMS, appleRemindersLink } from "@/lib/apple";
import { byDoneAt, doneToday, startOfToday } from "@/lib/done";
import { localIso, when } from "@/lib/format";
import { ITEM_COLUMNS, type Item } from "@/lib/types";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
/** Older completed items load this many at a time. */
const EARLIER_PAGE = 50;

function Row({ item, pill, onToggle, children }: { item: Item; pill?: React.ReactNode; onToggle: (i: Item) => void; children?: React.ReactNode }) {
  return (
    <div className="item" data-testid="item">
      <input type="checkbox" checked={item.state === "done"} onChange={() => onToggle(item)} aria-label={`Done: ${item.text}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={item.state === "done" ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
          {item.text} {pill}
          {item.apple_sent_at && <span className="pill ok" style={{ marginLeft: 6 }}>In Apple Reminders</span>}
        </div>
        {/* Where it came from and when, as one line. Tapping it opens the recording at that moment. */}
        {item.recording_id && item.recording ? (
          <Link className="source" href={`/notes/${item.recording_id}${item.at_ms !== null ? `?t=${item.at_ms}` : ""}`} data-testid="item-source">
            {item.recording.title ?? "Recording"} • {day(item.recording.started_at)}
          </Link>
        ) : (
          <span className="source">Added by hand • {day(item.created_at)}</span>
        )}
        {children}
      </div>
    </div>
  );
}

export default function TodosPage() {
  const { db, trash, refreshOverdue } = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  const [apple, setApple] = useState(false);
  // Completed before today: not loaded until asked for. withDoneAt is false on a database set up before
  // completion times existed, where Done shows the 15 newest completed items as it used to.
  const [earlier, setEarlier] = useState<{ list: Item[]; read: number; more: boolean } | null>(null);
  const [withDoneAt, setWithDoneAt] = useState(true);
  const [sent, setSent] = useState<string[]>([]);
  const [newText, setNewText] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});

  const source = `recording:recordings(title, started_at${trash ? ", deleted_at" : ""})`;
  const load = useCallback(async () => {
    // Open items and today's completed ones are read separately, so completed items piling up can never
    // push an open one off the list.
    const [{ data: open }, today, { data: settings }] = await Promise.all([
      db.from("items").select(`${ITEM_COLUMNS}, ${source}`)
        .eq("is_test", false).in("state", ["suggested", "active"]).order("created_at", { ascending: false }).limit(500),
      db.from("items").select(`${ITEM_COLUMNS}, done_at, ${source}`)
        .eq("is_test", false).eq("state", "done").gte("done_at", startOfToday().toISOString()).order("done_at", { ascending: false }),
      db.from("settings").select("apple_reminders").maybeSingle(),
    ]);
    let done = today.data as unknown as Item[] | null;
    setWithDoneAt(!today.error);
    if (today.error) {
      // A database without completion times (the setup script not yet run again): Done as it used to be.
      const old = await db.from("items").select(`${ITEM_COLUMNS}, ${source}`)
        .eq("is_test", false).eq("state", "done").order("created_at", { ascending: false }).limit(15);
      done = old.data as unknown as Item[] | null;
    }
    // Items from a recording that is in Trash are hidden until it is restored.
    setItems([...((open as unknown as Item[]) ?? []), ...(done ?? [])].filter((i) => !i.recording?.deleted_at));
    setEarlier(null);
    setApple(settings?.apple_reminders ?? false);
    refreshOverdue();
  }, [db, source, refreshOverdue]);

  const showEarlier = async () => {
    const read = earlier?.read ?? 0;
    let q = db.from("items").select(`${ITEM_COLUMNS}${withDoneAt ? ", done_at" : ""}, ${source}`).eq("is_test", false).eq("state", "done");
    if (withDoneAt) q = q.order("done_at", { ascending: false, nullsFirst: false });
    const { data } = await q.order("created_at", { ascending: false }).range(read, read + EARLIER_PAGE - 1);
    const page = (data as unknown as Item[] | null) ?? [];
    // What Done today already shows, or Trash hides, is left out.
    const shown = new Set((items ?? []).map((i) => i.id));
    const fresh = page.filter((i) => !shown.has(i.id) && !doneToday(i) && !i.recording?.deleted_at);
    setEarlier({ list: [...(earlier?.list ?? []), ...fresh], read: read + page.length, more: page.length === EARLIER_PAGE });
  };
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const patch = async (ids: string[], values: Partial<Item>) => {
    // The database stamps the completion time itself; this copy only places the item on screen meanwhile.
    const stamp = values.state ? { done_at: values.state === "done" ? new Date().toISOString() : null } : {};
    // An older completed item opened again moves up to the open lists.
    const reopened = values.state && values.state !== "done" ? (earlier?.list ?? []).filter((i) => ids.includes(i.id)) : [];
    setItems((list) => [...(list?.map((i) => (ids.includes(i.id) ? { ...i, ...values, ...stamp } : i)) ?? []), ...reopened.map((i) => ({ ...i, ...values, ...stamp }))]);
    if (reopened.length) setEarlier((e) => e && { ...e, list: e.list.filter((i) => !ids.includes(i.id)) });
    await db.from("items").update(values).in("id", ids);
    refreshOverdue();
  };
  const toggle = (i: Item) => patch([i.id], { state: i.state === "done" ? "active" : "done" });

  if (!items) return <><HomeHeader /><p className="muted">Loading…</p></>;
  const nowMs = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const active = items.filter((i) => i.state === "active");
  const dated = active.filter((i) => i.due_at).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const overdue = dated.filter((i) => new Date(i.due_at!).getTime() < nowMs);
  const today = dated.filter((i) => { const t = new Date(i.due_at!).getTime(); return t >= nowMs && t <= endOfToday.getTime(); });
  const upcoming = dated.filter((i) => new Date(i.due_at!).getTime() > endOfToday.getTime());
  const undated = active.filter((i) => !i.due_at);
  const review = items.filter((i) => i.state === "suggested");
  const doneItems = items.filter((i) => doneToday(i)).sort(byDoneAt);
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
      <HomeHeader />
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

      {section(withDoneAt ? "Done today" : "Done", doneItems, () => null)}
      {active.length + review.length + doneItems.length === 0 && !earlier && <p className="muted">Nothing yet. Record something and its to-dos will appear here.</p>}

      {/* Completed before today: kept, and here on request. Each stays in its conversation and in search too. */}
      {!earlier ? (
        <button className="btn small secondary" style={{ alignSelf: "center" }} onClick={() => void showEarlier()} data-testid="show-earlier">Show earlier</button>
      ) : (
        <section className="card" data-testid="earlier">
          <div className="label">Completed earlier</div>
          {earlier.list.length === 0 && <p className="small muted">Nothing completed before today.</p>}
          {earlier.list.map((i) => <Row key={i.id} item={i} onToggle={toggle} pill={i.done_at ? <span className="pill">Done {day(i.done_at)}</span> : null} />)}
          {earlier.more && <button className="btn small secondary" onClick={() => void showEarlier()}>Show more</button>}
        </section>
      )}
    </>
  );
}
