# Setup guide (zero experience assumed)

A one-time setup, about 30–40 minutes, done entirely in your web browser. You
don't install anything on your computer. When you're done, the app lives at:

**https://jonathanskim96-ctrl.github.io/horizon-tasks/**

It rebuilds and republishes itself automatically every time new code is pushed.

| Piece | What it is | Why |
|---|---|---|
| **Supabase project** | An online database with a sign-in system (free tier). | Stores and syncs your tasks. |
| **Google OAuth client** | A "Sign in with Google" registration in Google Cloud (free). | Lets Supabase confirm that it's you. |
| **GitHub Pages** | Free hosting built into GitHub. | Serves the app at the address above. |

> **Keep private:** database password, Google **Client secret**, and any Supabase
> **secret / service_role** key. The **Project URL** and **publishable key**
> are meant to be public: they end up inside the web app anyway, and your data
> is protected by sign-in plus database rules (RLS).

In every link below, `<ref>` is your project ref: the part of your Project URL
before `.supabase.co`.

Menus get renamed often. If a label doesn't match exactly, look for the closest one.

---

## Part 1 — Create the Supabase project

1. Go to **https://supabase.com** → **Sign in** → **Continue with GitHub**.
2. **New project** → name `horizon-tasks`; **Generate a password** and save it in
   your password manager; choose a West US region → **Create new project**.
3. Note the **Project URL** and **Publishable key** (under **Connect** or
   **Project Settings → API Keys**).

## Part 2 — Create the database tables

This step pastes one file of database instructions (SQL) into Supabase and runs it.
It creates the four tables the app uses and the security rules that keep them private to you.

1. **Open the SQL file as plain text.** In a new browser tab, open:
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/migrations/0001_init.sql`
   You'll see a page of plain text starting with `-- Horizon Tasks schema v1.`
2. **Copy all of it.** Click anywhere in the text, press **Ctrl + A** (Mac: **Cmd + A**)
   to select everything, then **Ctrl + C** (Mac: **Cmd + C**) to copy.
3. **Open Supabase's SQL editor.** Go to `https://supabase.com/dashboard/project/<ref>/sql/new`.
   Or, in your project, click the **SQL Editor** icon in the left sidebar (it looks like
   `>_`) and then **+ → New query**. You'll see a big empty text box.
4. **Paste.** Click inside the empty box, press **Ctrl + A** to clear any sample text, then
   **Ctrl + V** (Mac: **Cmd + V**). The box now holds about 200 lines.
5. **Run it.** Click the green **Run** button (bottom-right of the box), or press
   **Ctrl + Enter** (Mac: **Cmd + Enter**).
   - Supabase will pop up **"Potential issue detected … destructive operations"**.
     That's expected and safe here. Its scanner sees the words `delete` / `on delete
     cascade` in the file, but those only *define* rules for later (e.g. "deleting a
     task also deletes its subtasks"). Running the file deletes nothing, and your
     project is empty. Click **Run query**.
6. **Check the result.** The panel under the box should say
   **"Success. No rows returned."** That's the correct result: the file creates
   things but doesn't return any data.
   - If you see a red error mentioning `already exists`, the file has already been
     run once, which is fine. Don't run it again.
   - For any other red error, copy the message and send it to Claude.
7. **Confirm the tables exist.** Open **Table Editor** (`https://supabase.com/dashboard/project/<ref>/editor`).
   Under the `public` schema you should see four tables: **categories**, **completions**,
   **profiles** and **tasks**, all empty. Categories get created on your first sign-in.

8. **Run the second file the same way.** Repeat steps 1–6 with
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/migrations/0002_hardening.sql`
   (security tightening: signed-out visitors get no access at all, plus size limits).
   It may show the same warning, because it removes permissions. Click **Run query**.
   Expect **"Success. No rows returned."**

9. **And the third file**, the same way:
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/migrations/0003_limits_and_shapes.sql`
   (fixes size limits for long non-English text, stricter data checks). Expect
   the same warning (it replaces a function and two limits) → **Run query** →
   "Success. No rows returned."

10. **And the fourth file**, the same way:
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/migrations/0004_stale_write_guard.sql`
   (stops a task completed on two devices from being recorded twice). Same
   warning → **Run query** → "Success. No rows returned."

11. **And the fifth file**, the same way:
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/migrations/0005_realtime.sql`
   (turns on instant sync between your devices). → **Run query** → "Success. No rows returned."

Each migration file runs **once**, in number order. Future changes will arrive as new files
(`0002_…`, `0003_…`), and you'll run them the same way.

> **Shortcut for the future:** connect the **Supabase connector** at
> https://claude.ai/customize/connectors and start a new Claude session. Claude
> can then run migrations and check your tables for you, so you won't need to copy and paste.

## Part 3 — Create Google sign-in

1. Go to **https://console.cloud.google.com** and sign in with the Gmail you'll use for the app.
2. Project picker (top-left) → **New project** → `Horizon Tasks` → **Create** → select it.
3. Search bar → **Google Auth Platform** → **Get started**: app name `Horizon Tasks`,
   support email = your Gmail, Audience **External**, contact email = your Gmail →
   agree → **Create**.
4. **Audience → Test users → Add users** → your Gmail → **Save**. Only emails on this
   list can ever sign in.
5. **Clients → Create client** → type **Web application**, name `Horizon Tasks web`.
   Under **Authorized redirect URIs** → **Add URI** →
   `https://<ref>.supabase.co/auth/v1/callback` → **Create**.
6. Copy the **Client ID** and **Client secret** now. Google may not show the secret again.

## Part 4 — Connect Google to Supabase

1. Open `https://supabase.com/dashboard/project/<ref>/auth/providers` → **Google** →
   turn it on → paste the Client ID and Client secret → **Save**.
   Check that the **Callback URL** shown there matches the one you gave Google.
2. Open `https://supabase.com/dashboard/project/<ref>/auth/url-configuration`:
   - **Site URL:** `https://jonathanskim96-ctrl.github.io/horizon-tasks/`
   - **Redirect URLs → Add URL:** `https://jonathanskim96-ctrl.github.io/horizon-tasks/**`
     (optionally also `http://localhost:5173/**` for running it on your own computer)
   - Click **Save**.

## Part 5 — Turn on automatic publishing (GitHub Pages)

1. **Enable Pages:** open https://github.com/jonathanskim96-ctrl/horizon-tasks/settings/pages →
   under **Build and deployment → Source**, choose **GitHub Actions**. There's no save
   button; the change applies immediately.
2. **Give the build your two public values:** open
   https://github.com/jonathanskim96-ctrl/horizon-tasks/settings/variables/actions →
   make sure the **Variables** tab is selected (not Secrets) → **New repository variable**:
   - Name `VITE_SUPABASE_URL`, value = your Project URL → **Add variable**
   - Name `VITE_SUPABASE_ANON_KEY`, value = your publishable key → **Add variable**
3. **Publish it for the first time:** open https://github.com/jonathanskim96-ctrl/horizon-tasks/actions →
   click **Deploy to GitHub Pages** in the left list → **Run workflow** (right side) →
   **Run workflow**. Wait about 1–2 minutes for a green check mark.
   From now on, every new push publishes automatically.

## Part 6 — First sign-in

1. Open **https://jonathanskim96-ctrl.github.io/horizon-tasks/** → **Sign in with Google**.
   If Google says "Google hasn't verified this app", that's expected for your own
   app: click **Continue**.
2. You should see **6 categories · 0 history**. In Supabase's Table Editor,
   `categories` now has MPH, Core Lab, KFAM, Admin, Financial and Other.
3. **On your phone:** open the same address. On iPhone, tap Safari's **Share** →
   **Add to Home Screen**. On Android, open Chrome's **⋮** menu → **Install app**.

## Part 7 — Lock the door

Do this *after* your first sign-in. Open
`https://supabase.com/dashboard/project/<ref>/auth/providers` (or
**Authentication → Sign In / Providers**):
1. Turn **off "Allow new users to sign up"** → **Save**. Nobody new can create an account.
2. In the provider list, click **Email** → turn it **off** → **Save**. Supabase turns
   email/password sign-in on by default, and the app only uses Google.

---

## Optional — run it on your own computer

You only need this if you want to try changes before they're published.
Install **Node.js LTS** (nodejs.org) and **Git** (git-scm.com; on Mac, run
`git --version` in Terminal and accept the install). Then, in a terminal:

```sh
git clone https://github.com/jonathanskim96-ctrl/horizon-tasks.git
cd horizon-tasks
npm install
cp .env.example .env.local   # then put your two values in .env.local
npm run dev                  # open http://localhost:5173
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Google: **"Ineligible accounts not added"** when adding a test user | Click your profile picture (top-right) to see the account's exact email, and enter that (often the no-dots spelling). If it still fails, skip the list: **Audience → Publish app**. That's safe for basic name/email sign-in, but then do Part 7 immediately after your first sign-in, because Supabase's sign-up switch becomes the lock. If **Publish app** is greyed out ("complete your configuration on the Branding page"), fill in Branding → App domain: home page `https://jonathanskim96-ctrl.github.io/horizon-tasks/`, privacy policy `https://jonathanskim96-ctrl.github.io/horizon-tasks/privacy.html`, authorized domain `jonathanskim96-ctrl.github.io`, and don't upload a logo (a logo triggers Google's review). |
| Deploy run fails at "Check config" | The two repository **variables** are missing or misnamed. Add them under the Variables tab (Part 5.2), not Secrets. |
| Deploy fails with "Pages not enabled" / 404 | Part 5.1: set Source to **GitHub Actions**, then rerun the workflow. |
| Google says **redirect_uri_mismatch** | The Google redirect URI must exactly equal Supabase's Callback URL. |
| Google says **access blocked / not a test user** | Add your Gmail under Google Auth Platform → Audience → Test users. |
| After sign-in you land on the wrong page, or a Supabase error | Recheck the Site URL and Redirect URLs (Part 4.2), including the `/horizon-tasks/` part. |
| Red banner "… relation … does not exist" | Part 2 didn't run successfully. Redo it. |
| Red banner "Signups not allowed" | You did Part 7 before signing in. Turn sign-ups on, sign in once, then turn them off. |
