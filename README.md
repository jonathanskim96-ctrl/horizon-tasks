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

Full step-by-step walkthrough: [`docs/SETUP.md`](docs/SETUP.md). Summary:

1. **Supabase project** → SQL Editor → run each file in `supabase/migrations/` in order.
2. **Google OAuth client** (Google Cloud Console → APIs & Services → Credentials):
   type *Web application*; authorized redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → **Google**: enable, paste Client ID/Secret.
4. Supabase → Authentication → URL Configuration: Site URL `http://localhost:5173`
   (add the deployed URL later) and the same in the redirect allow-list.
5. Sign in once, then Supabase → Authentication → Sign In / Providers →
   turn **off "Allow new users to sign up"** so nobody else can create an account.

See `NOTES.md` for design decisions and the working process.
