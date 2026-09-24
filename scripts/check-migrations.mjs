#!/usr/bin/env node
// Guardrail for database migrations (run in CI and before every deploy).
//  1. Applied migrations are immutable: every file recorded in
//     supabase/migrations.lock.json must still exist with the same hash, and
//     (with BASE_SHA set) no existing lock entry may change between commits.
//  2. New migrations may not contain destructive SQL (drop / truncate /
//     delete / disabling RLS / granting delete…) unless the line carries an
//     explicit "guardrail-approved: <reason>" comment — which, per CLAUDE.md,
//     only the repository owner may authorize.
//  3. New migrations must be recorded in the lock (append-only):
//     `node scripts/check-migrations.mjs --record` adds new files only.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const LOCK = 'supabase/migrations.lock.json'
const DESTRUCTIVE = [
  /\bdrop\s+(table|schema|column|database|view|materialized\s+view|function|policy|trigger|publication|index|type|role|owned)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[^;]*\bdrop\b/i,
  /\bdisable\s+row\s+level\s+security\b/i,
  /\bno\s+force\s+row\s+level\s+security\b/i,
  /\bgrant\b[^;]*\b(truncate|delete|all)\b/i,
  /\balter\s+publication\b[^;]*\bdrop\b/i,
  /\bsecurity\s+definer\b/i,
]
const sha = (f) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex')
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {}
const problems = []
const approvals = []

// 1. Applied migrations are immutable.
for (const [f, hash] of Object.entries(lock)) {
  if (!files.includes(f)) problems.push(`${f}: an applied migration was deleted. Write a new migration instead.`)
  else if (sha(f) !== hash) problems.push(`${f}: an applied migration was edited. Never edit applied migrations; add a new numbered file.`)
}
if (process.env.BASE_SHA && !/^0+$/.test(process.env.BASE_SHA)) {
  let before = null
  try {
    before = JSON.parse(execFileSync('git', ['show', `${process.env.BASE_SHA}:${LOCK}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    /* lock didn't exist at base */
  }
  if (before)
    for (const [f, hash] of Object.entries(before))
      if (lock[f] !== hash) problems.push(`${LOCK}: the recorded hash for ${f} was changed or removed. The lock is append-only.`)
}

// 2 + 3. New migrations: no unapproved destructive SQL; must be recorded.
const fresh = files.filter((f) => !(f in lock))
for (const f of fresh) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(f)) problems.push(`${f}: name must look like 0007_short_description.sql`)
  readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/--.*$/, '')
    if (!DESTRUCTIVE.some((re) => re.test(code))) return
    const approved = /--\s*guardrail-approved:\s*\S/.test(line)
    if (approved) approvals.push(`${f}:${i + 1}: ${line.trim()}`)
    else problems.push(`${f}:${i + 1}: destructive SQL needs explicit owner approval ("-- guardrail-approved: <reason>"):\n    ${line.trim()}`)
  })
}

if (process.argv.includes('--record')) {
  if (problems.length) {
    console.error('Not recording: fix these first.')
  } else {
    for (const f of fresh) lock[f] = sha(f)
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n')
    console.log(fresh.length ? `Recorded: ${fresh.join(', ')}` : 'Nothing new to record.')
  }
} else if (fresh.length) {
  problems.push(`Not recorded in ${LOCK}: ${fresh.join(', ')} — run: node scripts/check-migrations.mjs --record`)
}

for (const a of approvals) console.log(`APPROVED destructive line — ${a}`)
if (problems.length) {
  console.error('\nMigration guardrail FAILED:\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log(`Migration guardrail passed (${files.length} migrations, ${Object.keys(lock).length} locked).`)
