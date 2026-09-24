# Setup guide (zero experience assumed)

This is a one-time setup, about 45–60 minutes. You'll create three things, then
run the app on your own computer:

| Piece | What it is | Why you need it |
|---|---|---|
| **Supabase project** | An online database with a sign-in system. The free tier is enough. | Stores your tasks and syncs them across devices. |
| **Google OAuth client** | A "Sign in with Google" registration in Google Cloud. Free. | Lets Supabase confirm that it's really you signing in. |
| **The app on your computer** | The code from GitHub, running locally. | Lets you test it before it's hosted online. |

> **Keep these private:** database password, Google **Client secret**, Supabase
> **secret / service_role** key. Never paste them into GitHub or a chat.
> The Supabase **publishable / anon** key and the **project URL** are designed to be
> public-ish, but they still go only in `.env.local` (which git ignores).

Keep a scratch note open. You'll collect these values as you go:

```
Project URL:          https://xxxxxxxx.supabase.co
Project ref:          xxxxxxxx              (the part before .supabase.co)
Publishable/anon key: sb_publishable_...   (or a long eyJ... string)
Google Client ID:     ....apps.googleusercontent.com
Google Client secret: GOCSPX-...           (private!)
```

Website menus get renamed often. If a label below doesn't match exactly, look
for the closest match. The structure stays the same.

---

## Part 1 — Create the Supabase project (≈10 min)

1. Go to **https://supabase.com** → **Sign in** (or **Start your project**). The
   easiest way is **Continue with GitHub** using your GitHub account.
2. If asked to create an **organization**, name it anything (e.g. your name),
   type **Personal**, plan **Free**.
3. Click **New project**:
   - **Name:** `horizon-tasks`
   - **Database password:** click **Generate a password**, then save it in your
     password manager. The app doesn't use it, but you may need it someday.
   - **Region:** a West US region (closest to Los Angeles).
   - Click **Create new project**. Setup takes 1–2 minutes.
4. **Copy your project URL and key:**
   - Click **Connect** at the top of the project page, or go to **Project Settings**
     (gear icon, bottom-left) → **Data API** / **API Keys**.
   - Copy the **Project URL** (`https://xxxxxxxx.supabase.co`). The `xxxxxxxx` part
     is your **project ref**.
   - Copy the **Publishable key** (starts `sb_publishable_`). If you only see
     "legacy" keys, copy the **anon public** one. **Don't** copy the
     *secret* / *service_role* key.

## Part 2 — Create the database tables (≈5 min)

1. Open the migration file on GitHub:
   `https://github.com/jonathanskim96-ctrl/horizon-tasks/blob/claude/horizon-tasks-pwa-rebuild-3bnzjv/supabase/migrations/0001_init.sql`
   (after this is merged to `main`, use `main` in place of the branch name).
2. Click the **Copy raw file** button (two overlapping squares, top-right of the file).
3. In Supabase, left sidebar → **SQL Editor** → **New query** (or the **+** button).
4. Paste everything and click **Run** (or Ctrl/Cmd + Enter).
5. You should see **"Success. No rows returned."** If Supabase warns that the query
   is "destructive" or asks for confirmation, confirm.
6. Check: left sidebar → **Table Editor**. You should see `categories`,
   `completions`, `profiles` and `tasks`, all empty. Each one should have RLS
   ("Row Level Security") shown as enabled.

Run each migration file only once. Later changes will come as new files
(`0002_...sql`), and you'll run those the same way.

## Part 3 — Create the Google sign-in client (≈15 min)

1. Go to **https://console.cloud.google.com** and sign in with the Google account
   you'll use for the app. Accept the terms if asked.
2. **Create a project:** click the project picker at the top-left (next to
   "Google Cloud") → **New project** → name `Horizon Tasks` → **Create**. Wait for
   it, then make sure it's selected in the picker.
3. **Set up the consent screen:** search bar → type **"Google Auth Platform"**
   (older name: "OAuth consent screen") → open it → **Get started**:
   - **App name:** `Horizon Tasks`; **User support email:** your Gmail.
   - **Audience:** **External**.
   - **Contact email:** your Gmail → agree to the policy → **Create**.
4. **Add yourself as a test user:** in Google Auth Platform → **Audience** →
   **Test users** → **Add users** → your Gmail → **Save**.
   The app stays in "Testing" mode, so *only* the emails listed here can ever sign in.
   For a single-user app that's a useful extra lock, and you don't need
   to publish or verify the app.
5. **Create the client:** Google Auth Platform → **Clients** → **Create client**:
   - **Application type:** **Web application**
   - **Name:** `Horizon Tasks web`
   - **Authorized JavaScript origins:** you can leave this empty.
   - **Authorized redirect URIs** → **Add URI** →
     `https://<project-ref>.supabase.co/auth/v1/callback`
     (use your real project ref, e.g. `https://abcdwxyz.supabase.co/auth/v1/callback`).
   - Click **Create**.
6. A box shows the **Client ID** and **Client secret**. Copy both into your scratch
   note now, or click **Download JSON**. Google may not show the secret again.

## Part 4 — Connect Google to Supabase (≈5 min)

1. Supabase → left sidebar → **Authentication** → **Sign In / Providers** (older
   name: "Providers") → **Google**.
2. Turn **Enable Sign in with Google** on.
3. Paste the **Client ID** (the field may be called "Client IDs") and the **Client
   secret**. Leave other options at their defaults → **Save**.
4. That panel also shows a **Callback URL**. Check that it's exactly the one you put
   in Google (Part 3, step 5). If it differs, fix it in Google.
5. Supabase → **Authentication** → **URL Configuration**:
   - **Site URL:** `http://localhost:5173`
   - **Redirect URLs** → **Add URL** → `http://localhost:5173/**` → **Save**.
   (When the app is deployed online later, you'll add its web address here too.)

## Part 5 — Install tools on your computer (≈10 min, once)

You need **Node.js**, which runs the app's build tools, and **Git**, which downloads the code.

- **Node.js:** https://nodejs.org → download the **LTS** installer → run it with
  default options.
- **Git:**
  - Mac: open **Terminal** (Cmd + Space, type "Terminal") and type `git --version`.
    If it asks to install developer tools, click **Install**.
  - Windows: https://git-scm.com/download/win → run the installer with default options.

Check that both installed. Open a terminal (Mac: **Terminal**; Windows: **Git Bash**,
which Git installed) and run:

```sh
node --version    # should print v20 or higher
git --version
```

## Part 6 — Run the app (≈10 min)

In the terminal, run these one at a time:

```sh
cd ~                        # go to your home folder (or wherever you keep projects)
git clone https://github.com/jonathanskim96-ctrl/horizon-tasks.git
cd horizon-tasks
git checkout claude/horizon-tasks-pwa-rebuild-3bnzjv   # skip once merged to main
npm install                 # downloads libraries; takes a minute
cp .env.example .env.local  # makes your private settings file
```

Now open `.env.local` in a text editor. On Mac, `open -e .env.local` opens it in
TextEdit. On Windows, `notepad .env.local`. Replace the two placeholder lines
with your values. No quotes, no spaces around `=`:

```
VITE_SUPABASE_URL=https://abcdwxyz.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxx
```

Save and close it. Then:

```sh
npm run dev
```

The terminal prints `Local: http://localhost:5173/`. Open that address in your
browser. Leave the terminal running; press Ctrl + C to stop the app when you're done.

## Part 7 — First sign-in (≈2 min)

1. Click **Sign in with Google** → pick your account. Google may warn that
   "Google hasn't verified this app". That's expected for your own Testing-mode app:
   click **Continue**.
2. You land back on the app, signed in. It should show **6 categories · 0 history**
   and zeros for the task counts.
3. Check in Supabase → **Table Editor** → `categories`: the six rows (MPH, Core Lab,
   KFAM, Admin, Financial, Other) are there.

## Part 8 — Lock the door (1 min)

Supabase → **Authentication** → **Sign In / Providers** (or **Settings**) → turn
**off "Allow new users to sign up"** → **Save**. You can still sign in because
your account already exists, but nobody else can create one. (Google's test-user
list from Part 3 is a second lock.)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "Supabase is not configured" | `.env.local` is missing, misnamed, or has typos. Fix it, then stop (Ctrl + C) and rerun `npm run dev`. |
| Google says **redirect_uri_mismatch** | The redirect URI in Google (Part 3.5) must match Supabase's Callback URL exactly: `https`, no trailing slash. |
| Google says **access blocked / not a test user** | Add your Gmail under Google Auth Platform → Audience → Test users. |
| After Google sign-in you land on a Supabase error page or the wrong address | Check Site URL / Redirect URLs in Part 4.5. |
| Red banner: "… failed: relation … does not exist" | The migration didn't run. Redo Part 2. |
| Red banner: "Signups not allowed" on first sign-in | You did Part 8 too early. Turn sign-ups back on, sign in once, then turn them off. |
| `npm: command not found` | Node.js isn't installed, or the terminal was opened before installing. Close the terminal, reopen it and try again. |

When everything works, tell Claude "setup done" and the screens come next.
