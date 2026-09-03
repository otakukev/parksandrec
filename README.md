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

This is a stateful Node process (in-memory presence + a local SQLite file),
so run it as a single long-lived process behind a reverse proxy (nginx,
Caddy, etc.) that terminates TLS, and set in `.env`:

```
NODE_ENV=production
SESSION_SECRET=<a long random string>
```

`NODE_ENV=production` makes session cookies `secure` (HTTPS-only), so put a
TLS-terminating proxy in front of it, or those cookies won't be sent.

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
```
