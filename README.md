# Parks & Rec Hub

A small live team hub for a multi-user workplace: real-time group chat with
@mentions, and a manager/admin-only announcement board. Every user signs in,
so every message and post is attributed to a real account.

## Features

- **Login required for everyone.** No anonymous access — the login screen is
  the only way in, and every chat message / board post shows the signed-in
  author's name and role.
- **Live group chat** (Socket.IO) with:
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

## Requirements

- Node.js 20+ (uses `better-sqlite3`, a native module, so a first `npm
  install` will build it — no separate database server needed).

## Setup

```bash
npm install
cp .env.example .env   # then edit SESSION_SECRET, admin credentials, etc.
npm start
```

The server prints the admin username the first time it starts against an
empty database (defaults to `admin` / `changeme123` unless you set
`ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` first). **Sign in as that
account and create real accounts for your team from the "Manage Users" tab,
then change/retire the seed admin password.**

Visit `http://localhost:3000`.

## How accounts work

There's no public sign-up page on purpose — only an admin can create
accounts (Manage Users tab), so you always know exactly who has access and
what role they hold. Give each teammate their own login; that's what makes
"who sent this" and "who's online/typing right now" meaningful.

## Data

All data (users, chat history, board posts, sessions) lives in SQLite files
under `data/`, which is gitignored. Back that directory up if you care about
history.

## Deploying it "live"

This is a stateful Node process (in-memory presence + local SQLite files), so
it needs a host that runs one persistent process with persistent disk — not
a serverless platform like Vercel/Netlify, where the filesystem doesn't
survive between requests and long-lived WebSocket connections get cut.

### Deploy on Railway (recommended)

1. **Push this repo to GitHub** (already done — this project lives at
   `otakukev/parksandrec`).
2. **Create a project:** at [railway.app](https://railway.app), New Project →
   *Deploy from GitHub repo* → pick `otakukev/parksandrec` and the branch you
   want live (e.g. `main` once PR #1 is merged, or the feature branch to
   preview it first). Railway auto-detects Node via Nixpacks and uses this
   repo's `Procfile` / `railway.json` (start command `node server.js`,
   health check `/healthz`).
3. **Add a persistent volume** (Project → your service → Volumes → *New
   Volume*): mount path `/data`. Without this, every redeploy wipes all
   users, chat history, and board posts.
4. **Set environment variables** (service → Variables):
   ```
   NODE_ENV=production
   DATA_DIR=/data
   SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   ADMIN_USERNAME=<pick something other than "admin">
   ADMIN_PASSWORD=<a real password, not the example one>
   ```
   Railway supplies `PORT` automatically — the app already reads it.
5. **Generate a public URL:** service → Settings → Networking → *Generate
   Domain*. Railway terminates TLS for you, so `NODE_ENV=production`'s
   secure cookies work out of the box.
6. **First login:** visit the generated URL, sign in with the
   `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set, and create real accounts for
   your team from the "Manage Users" tab.
7. Every subsequent push to that branch auto-redeploys (data on the volume
   survives redeploys; it's only wiped if you delete the volume).

### Deploying elsewhere

Same idea on any platform that runs a persistent process with persistent
disk (Render with a paid disk, Fly.io with a volume, a plain VPS behind
nginx/Caddy): set `NODE_ENV=production`, a strong `SESSION_SECRET`, and
point `DATA_DIR` at whatever persistent mount the platform gives you.

## Project layout

```
server.js           Express app + Socket.IO wiring, session middleware
db.js                SQLite schema + initial admin seed
middleware/auth.js    requireAuth / requireRole guards
routes/auth.js        login / logout / current-user
routes/users.js        admin-only user creation + role changes
routes/board.js       announcement board CRUD (manager/admin write)
routes/messages.js    chat history REST endpoint
public/               login page + the chat/board/admin single-page app
Procfile              process type for Railway/Heroku-style hosts
railway.json          Railway build/start/health-check config
```
