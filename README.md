# Horizon Tasks

Personal task planner as an installable PWA (React + Vite + `vite-plugin-pwa`),
with data in Supabase behind Google sign-in. **This repo is code only: task
data lives only in Supabase and must never be committed.**

## Dev

```sh
npm install
cp .env.example .env.local   # fill in Supabase URL + anon key
npm run dev
```

Checks (run all before pushing):

```sh
npm run typecheck && npm run lint && npm test
./supabase/tests/run.sh      # schema/RLS tests against a throwaway local Postgres
```

## One-time backend setup

Full step-by-step walkthrough (browser only, no installs): [`docs/SETUP.md`](docs/SETUP.md).
The app auto-deploys to GitHub Pages on every push to the default branch:
https://jonathanskim96-ctrl.github.io/horizon-tasks/

See `NOTES.md` for design decisions and the working process.
