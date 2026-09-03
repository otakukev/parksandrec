const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { Server } = require('socket.io');

const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const boardRouter = require('./routes/board');
const messagesRouter = require('./routes/messages');

if (fs.existsSync(path.join(__dirname, '.env'))) {
  process.loadEnvFile(path.join(__dirname, '.env'));
}

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) app.set('trust proxy', 1); // required for secure cookies behind a TLS-terminating proxy
if (isProduction && !process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET is not set. Set a strong random SESSION_SECRET before running in production.');
}

const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: db.DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
});

app.use(express.json());
app.use(sessionMiddleware);

// Share the same session store with socket.io so a live connection knows who's talking.
io.engine.use(sessionMiddleware);

// Unauthenticated health check for the hosting platform's monitor.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/board', requireAuth, boardRouter);
app.use('/api/messages', requireAuth, messagesRouter);

// `index: false` so a signed-out visitor can't reach the app shell by requesting
// /app.html directly through the static handler, bypassing the session check below.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function serveApp(req, res) {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
}

app.get('/', serveApp);
app.get('/app.html', serveApp);

// ---- Live chat over Socket.IO ----

const CHANNEL = 'general';
// userId -> { user, socketIds: Set }
const presence = new Map();

function broadcastPresence() {
  const online = [...presence.values()].map(({ user }) => user);
  io.to(CHANNEL).emit('presence', { online });
}

function extractMentions(content, knownUsernames) {
  const found = new Set();
  const re = /@([a-z0-9_.]+)/gi;
  let match;
  while ((match = re.exec(content))) {
    const uname = match[1].toLowerCase();
    if (knownUsernames.has(uname)) found.add(uname);
  }
  return [...found];
}

io.on('connection', (socket) => {
  const sessionUser = socket.request.session && socket.request.session.user;
  if (!sessionUser) {
    socket.emit('auth-error', { error: 'Not signed in.' });
    socket.disconnect(true);
    return;
  }

  socket.data.user = sessionUser;
  socket.join(CHANNEL);

  if (!presence.has(sessionUser.id)) {
    presence.set(sessionUser.id, { user: sessionUser, socketIds: new Set() });
  }
  presence.get(sessionUser.id).socketIds.add(socket.id);
  broadcastPresence();

  socket.on('chat message', (payload, ack) => {
    try {
      const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
      if (!content || content.length > 2000) {
        if (typeof ack === 'function') ack({ error: 'Message must be 1-2000 characters.' });
        return;
      }

      const users = db.prepare('SELECT username FROM users').all();
      const knownUsernames = new Set(users.map((u) => u.username));
      const mentions = extractMentions(content, knownUsernames);

      const info = db.prepare(
        'INSERT INTO messages (channel, user_id, content, mentions) VALUES (?, ?, ?, ?)'
      ).run(CHANNEL, sessionUser.id, content, JSON.stringify(mentions));

      const message = {
        id: info.lastInsertRowid,
        channel: CHANNEL,
        content,
        mentions,
        createdAt: new Date().toISOString(),
        author: { id: sessionUser.id, displayName: sessionUser.displayName, username: sessionUser.username, role: sessionUser.role },
      };

      io.to(CHANNEL).emit('chat message', message);
      if (typeof ack === 'function') ack({ ok: true, message });
    } catch (err) {
      console.error('chat message error:', err);
      if (typeof ack === 'function') ack({ error: 'Failed to send message.' });
    }
  });

  socket.on('typing', (payload) => {
    const isTyping = Boolean(payload?.isTyping);
    socket.to(CHANNEL).emit('typing', {
      user: { id: sessionUser.id, displayName: sessionUser.displayName, username: sessionUser.username },
      isTyping,
    });
  });

  socket.on('disconnect', () => {
    const entry = presence.get(sessionUser.id);
    if (entry) {
      entry.socketIds.delete(socket.id);
      if (entry.socketIds.size === 0) presence.delete(sessionUser.id);
    }
    broadcastPresence();
    socket.to(CHANNEL).emit('typing', {
      user: { id: sessionUser.id, displayName: sessionUser.displayName, username: sessionUser.username },
      isTyping: false,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Parks & Rec hub running at http://localhost:${PORT}`);
});
