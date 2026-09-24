// Tiny in-memory stand-in for Supabase (PostgREST + RPCs) with fault injection.
export function createMock() {
  const db = { categories: [], tasks: [], completions: [] }
  const faults = { failLoad: 0, failWrite: 0, abortWrite: 0, offline: false, slowMs: 0 }
  const calls = { apply: 0 }
  let n = 0
  const id = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  async function handler(route) {
    if (faults.offline) return route.abort('internetdisconnected')
    const req = route.request(); const p = new URL(req.url()).pathname
    const body = req.postData() ? JSON.parse(req.postData()) : null
    const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) })
    if (p === '/rest/v1/rpc/seed_starter_categories') {
      if (db.categories.length) return json(false)
      body.starter.forEach((s, i) => db.categories.push({ id: id(), name: s.name, color: s.color, sort_order: i }))
      return json(true)
    }
    if (p === '/rest/v1/rpc/apply_changes') {
      calls.apply++
      if (faults.abortWrite) { faults.abortWrite--; return route.abort('failed') }
      if (faults.failWrite) { faults.failWrite--; return json({ message: 'simulated server error' }, 500) }
      await new Promise((r) => setTimeout(r, 150 + faults.slowMs)) // realistic latency so double-taps overlap
      // Mirror 0004: stale deletes/updates fail the whole batch.
      const stale = body.deletes.some((id) => !db.tasks.some((t) => t.id === id)) ||
        body.updates.some((u) => !db.tasks.some((t) => t.id === u.id)) ||
        body.history_deletes.some((id) => !db.completions.some((c) => c.id === id))
      if (stale) return json({ message: 'stale: this task was already changed on another device' }, 400)
      for (const c of body.completions) db.completions.push({ ...c })
      const del = new Set(body.deletes)
      let grew = true
      while (grew) { grew = false; for (const t of db.tasks) if (t.parent_id && del.has(t.parent_id) && !del.has(t.id)) { del.add(t.id); grew = true } }
      db.tasks = db.tasks.filter((t) => !del.has(t.id))
      db.tasks.push(...body.inserts)
      for (const t of body.updates) db.tasks = db.tasks.map((x) => (x.id === t.id ? t : x))
      db.completions = db.completions.filter((c) => !body.history_deletes.includes(c.id))
      return route.fulfill({ status: 204, body: '' })
    }
    if (p === '/rest/v1/categories' && (req.method() === 'PATCH' || req.method() === 'DELETE')) {
      const id = (new URL(req.url()).searchParams.get('id') ?? '').replace(/^eq\./, '')
      const cat = db.categories.find((c) => c.id === id)
      if (!cat) return json([])
      if (req.method() === 'PATCH') { Object.assign(cat, body); return json([{ id }]) }
      if (db.tasks.some((t) => t.category_id === id))
        return json({ message: 'update or delete on table "categories" violates foreign key constraint' }, 409)
      db.categories = db.categories.filter((c) => c.id !== id)
      return json([{ id }])
    }
    if (p === '/rest/v1/categories' && req.method() === 'POST') {
      const row = { id: id(), ...body }; db.categories.push(row); return json(row, 201)
    }
    const table = p.replace('/rest/v1/', '')
    if (db[table] && req.method() === 'GET') {
      if (faults.failLoad) { faults.failLoad--; return json({ message: 'simulated load failure' }, 503) }
      return json(db[table])
    }
    return json({})
  }
  /** Pre-populate before the app loads (starter categories + task rows). */
  function seed(tasks = []) {
    ;['MPH', 'Core Lab', 'KFAM', 'Admin', 'Financial', 'Other'].forEach((name, i) =>
      db.categories.push({ id: `cat-${i}`, name, color: ['#5b8cff', '#34c2b0', '#f2b84b', '#a687f0', '#4caf7d', '#8b929c'][i], sort_order: i }))
    for (const t of tasks)
      db.tasks.push({ notes: '', ongoing: false, checklist: [], parent_id: null, depth: 0, recurrence_every_n_days: null, recurrence_end_date: null, created_at: new Date().toISOString(), category_id: 'cat-3', priority: 3, ...t })
  }
  // ── Realtime (Phoenix v2 array protocol): enough to join and push changes.
  const sockets = new Set()
  function realtime(ws) {
    const chans = new Map() // topic → { joinRef, ids }
    sockets.add({ ws, chans })
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      if (event === 'phx_join') {
        const pc = (payload?.config?.postgres_changes ?? []).map((f, i) => ({ ...f, id: 1000 + i }))
        chans.set(topic, { joinRef, ids: pc.map((f) => f.id) })
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pc } }]))
      } else if (event === 'heartbeat' || event === 'access_token' || event === 'phx_leave') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  }
  /** Simulate another device changing a row: every joined channel is told. */
  function pushChange(table = 'tasks') {
    for (const { ws, chans } of sockets)
      for (const [topic, c] of chans)
        ws.send(JSON.stringify([null, null, topic, 'postgres_changes', {
          ids: c.ids,
          data: { type: 'UPDATE', schema: 'public', table, commit_timestamp: new Date().toISOString(), columns: [], record: {}, old_record: {}, errors: null },
        }]))
  }
  const joined = () => [...sockets].some((s) => s.chans.size > 0)
  return { db, faults, calls, handler, seed, realtime, pushChange, joined }
}

export const session = (uid) => JSON.stringify({
  access_token: 'x.eyJzdWIiOiJ1In0.y', token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'r',
  user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'me@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
})
