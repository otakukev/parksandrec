# Parks & Rec Hub

A small live team hub for a multi-user workplace: real-time group chat with
@mentions, and a manager/admin-only announcement board. Every user signs in,
so every message and post is attributed to a real account.

## Features

- **Login required for everyone.** No anonymous access — the login screen is
  the only way in, and every chat message / board post shows the signed-in
  author's name and role.
- **Live group chat** with:
  - message history on load
  - an "online now" presence list
  - "so-and-so is typing…" indicators
  - `@username` mentions — a mention is highlighted for everyone, and the
    message is visually flagged for the mentioned person
- **Announcement board** that only `admin` and `manager` accounts can post
  to. `worker` accounts can read it but the composer and delete controls are
  hidden and the server also rejects the request if someone tries anyway.
- **Roles:** `admin`, `manager`, `worker`.
  - `admin` — full access, plus a "Manage Users" tab to create accounts and
    change anyone's role.
  - `manager` — can post/delete their own announcements, chats like everyone
    else.
  - `worker` — chat only, read-only board.

## Architecture (why it's built this way)

This runs as **Netlify Functions** (an Express app wrapped for serverless)
backed by **Postgres**, with the login-gated REST API doing all reads and
writes.

Netlify Functions are short-lived and stateless, which rules out the more
obvious way to build "live" chat:

- **No WebSockets.** A serverless function can't hold a persistent
  connection, so instead of Socket.IO, the browser **polls** the server
  every ~2 seconds for new messages, typing status, and who's online.
  There's a few seconds of latency instead of instant push, but it needs no
  extra infrastructure and stays behind the same session-cookie auth as
  everything else.
- **No local disk.** All state (users, chat history, board posts, login
  sessions) lives in Postgres instead of a local SQLite file.

I deliberately avoided wiring the browser directly to a third-party realtime
service (e.g. Supabase Realtime, Ably, Pusher) for the live updates. Those
work by having the client subscribe with a public API key, which means
anyone holding that key can read the data stream **without ever passing
through this app's login** — a real regression from "everyone must sign in
to see anything." Polling through our own authenticated API avoids that
tradeoff entirely.

## Requirements

- Node.js 20+
- A Postgres database (local for dev; hosted for production — see below)

## Local setup

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and SESSION_SECRET at minimum
npm run migrate             # creates tables and seeds the initial admin account
npm start
```

`npm run migrate` prints the seeded admin username the first time it runs
against an empty database (defaults to `admin` / `changeme123` unless you
set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` first — running it again
against a database that already has users is a no-op). **Sign in as that
account and create real accounts for your team from the "Manage Users" tab,
then change/retire the seed admin password.**

Visit `http://localhost:3000`.

If you don't have a local Postgres, the quickest way to get one is
`docker run -e POSTGRES_PASSWORD=parksandrec -e POSTGRES_USER=parksandrec -e POSTGRES_DB=parksandrec -p 5432:5432 postgres:16`,
matching the example `DATABASE_URL` in `.env.example` (with `DATABASE_SSL=false`,
since a local Postgres usually doesn't have SSL configured).

## How accounts work

There's no public sign-up page on purpose — only an admin can create
accounts (Manage Users tab), so you always know exactly who has access and
what role they hold. Give each teammate their own login; that's what makes
"who sent this" and "who's online/typing right now" meaningful.

## Deploying it live, on Netlify

1. **Push this repo to GitHub** (already done — this project lives at
   `otakukev/parksandrec`).
2. **Get a Postgres database.** The easiest path, since it's provisioned
   from inside Netlify itself with no separate signup: from your Netlify
   site (after step 3) run `netlify db init` (or use the "Netlify DB"
   option in the site dashboard), which provisions a Neon Postgres database
   and gives you a `DATABASE_URL`. Any other hosted Postgres (Supabase,
   Neon directly, RDS, etc.) works too — you just need its connection
   string.
3. **Create the site:** at [app.netlify.com](https://app.netlify.com), *Add
   new site → Import an existing project* → pick `otakukev/parksandrec` and
   the branch you want live (e.g. `main` once PR #1 is merged, or the
   feature branch to preview it first). Netlify reads `netlify.toml`
   automatically (publish dir `public`, functions dir `netlify/functions`,
   `/api/*` routed to the function).
4. **Set environment variables** (Site configuration → Environment
   variables) — skip `DATABASE_URL` if `netlify db init` already set it:
   ```
   DATABASE_URL=<your Postgres connection string>
   DATABASE_SSL=true
   NODE_ENV=production
   SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ADMIN_USERNAME=<pick something other than "admin">
   ADMIN_PASSWORD=<a real password, not the example one>
   ```
5. **Run the migration once** against that same `DATABASE_URL` to create the
   schema and seed the admin account — easiest from your own machine:
   ```bash
   DATABASE_URL=<your connection string> DATABASE_SSL=true \
   ADMIN_USERNAME=<...> ADMIN_PASSWORD=<...> npm run migrate
   ```
6. **Deploy** (Netlify does this automatically on push, or trigger a deploy
   from the dashboard). Netlify terminates TLS for you, so
   `NODE_ENV=production`'s secure cookies work out of the box.
7. **First login:** visit the site URL, sign in with the `ADMIN_USERNAME` /
   `ADMIN_PASSWORD` you set, and create real accounts for your team from the
   "Manage Users" tab.

Every subsequent push to that branch auto-redeploys; your data lives in
Postgres, independent of the deploy, so it isn't touched by redeploys.

### Deploying elsewhere

This also runs as a normal persistent Node process (`node server.js`) — it
doesn't require Netlify specifically, only *a* Postgres database. Any host
that runs a long-lived Node process (Railway, Render, Fly.io, a VPS) works
too: set `DATABASE_URL`, `DATABASE_SSL`, `NODE_ENV=production`, and a strong
`SESSION_SECRET`, then run `npm run migrate` once followed by `npm start`.
This repo's `Procfile` and `railway.json` are there for that path.

## Project layout

```
app.js                     Express app: routes, sessions, middleware (no .listen())
server.js                  Local dev entry point — listens on PORT
netlify/functions/api.js   Wraps app.js for Netlify Functions (serverless-http)
netlify.toml               Netlify build/publish/redirect config
db.js                       Postgres connection pool
scripts/schema.sql          Table definitions
scripts/migrate.js          One-time setup: creates schema, seeds initial admin
middleware/auth.js          requireAuth / requireRole guards
routes/auth.js               login / logout / current-user
routes/users.js               admin-only user creation + role changes
routes/board.js              announcement board CRUD (manager/admin write)
routes/messages.js           initial chat history REST endpoint
routes/chat.js               send message, typing status, and the live poll endpoint
public/                     login page + the chat/board/admin single-page app
Procfile, railway.json      config for running this as a persistent process elsewhere
```
