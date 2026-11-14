// An in-memory stand-in for the parts of the Supabase client the worker uses, for unit tests only.
// Tables are plain arrays of rows; every query, RPC and storage call is recorded for the test to inspect.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { message: string } | null; count?: number | null };

export type FakeDb = ReturnType<typeof fakeDb>;

export function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, () => unknown> = {}) {
  const removed: string[] = [];
  const signed: string[] = [];
  const calls: string[] = [];

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row[] = [];
    let head = false;
    let limit = Infinity;
    let one: "single" | "maybe" | null = null;

    const run = (): Result => {
      const rows = tables[table];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const made = inserted.map((r) => ({ id: crypto.randomUUID(), ...r }));
        rows.push(...made);
        calls.push(`insert ${table} ${made.length}`);
        return { data: one ? { ...made[0] } : made.map((r) => ({ ...r })), error: null };
      }
      if (op === "update") { for (const r of hit) Object.assign(r, patch); calls.push(`update ${table} ${JSON.stringify(patch)}`); return { data: null, error: null }; }
      if (op === "delete") { tables[table] = rows.filter((r) => !hit.includes(r)); calls.push(`delete ${table} ${hit.length}`); return { data: null, error: null }; }
      if (head) return { data: null, error: null, count: hit.length };
      const out = hit.slice(0, limit).map((r) => ({ ...r }));
      if (one) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };

    const q = {
      select(_cols?: string, opts?: { head?: boolean }) { if (op === "select") head = Boolean(opts?.head); return q; },
      update(p: Row) { op = "update"; patch = p; return q; },
      delete() { op = "delete"; return q; },
      insert(rows: Row | Row[]) { op = "insert"; inserted = Array.isArray(rows) ? rows : [rows]; return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      is(c: string, v: null) { filters.push((r) => (r[c] ?? null) === v); return q; },
      not(c: string, _op: "is", v: null) { filters.push((r) => (r[c] ?? null) !== v); return q; },
      lt(c: string, v: string) { filters.push((r) => r[c] != null && String(r[c]) < v); return q; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return q; },
      order() { return q; },
      limit(n: number) { limit = n; return q; },
      single() { one = "single"; return q; },
      maybeSingle() { one = "maybe"; return q; },
      then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
        try { return Promise.resolve(resolve(run())); } catch (e) { return reject ? Promise.resolve(reject(e)) : Promise.reject(e); }
      },
    };
    return q;
  }

  return {
    tables, removed, signed, calls,
    client: {
      from,
      rpc: async (name: string) => ({ data: rpcs[name] ? rpcs[name]() : null, error: null }),
      storage: {
        from: () => ({
          remove: async (paths: string[]) => { removed.push(...paths); return { data: paths, error: null }; },
          createSignedUrl: async (path: string) => { signed.push(path); return { data: { signedUrl: `https://signed.test/${path}` }, error: null }; },
          list: async () => ({ data: [], error: null }),
        }),
      },
    },
  };
}
