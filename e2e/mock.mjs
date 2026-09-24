// Tiny in-memory stand-in for Supabase (PostgREST + RPCs) with fault injection.
export function createMock() {
  const db = { categories: [], tasks: [], completions: [] }
  const faults = { failLoad: 0, failWrite: 0, abortWrite: 0 }
  const calls = { apply: 0 }
  let n = 0
  const id = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
  async function handler(route) {
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
      await new Promise((r) => setTimeout(r, 150)) // realistic latency so double-taps overlap
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
  return { db, faults, calls, handler }
}

export const session = (uid) => JSON.stringify({
  access_token: 'x.eyJzdWIiOiJ1In0.y', token_type: 'bearer', expires_in: 3600, expires_at: 9999999999, refresh_token: 'r',
  user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'me@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
})
