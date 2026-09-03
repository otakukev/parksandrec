const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const pool = require('./db');
const { requireAuth } = require('./middleware/auth');
const { router: authRouter } = require('./routes/auth');
const usersRouter = require('./routes/users');
const boardRouter = require('./routes/board');
const messagesRouter = require('./routes/messages');
const chatRouter = require('./routes/chat');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', 1); // both Railway/Netlify and local dev sit behind a proxy/CDN

if (isProduction && !process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET is not set. Set a strong random SESSION_SECRET before running in production.');
}

const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
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

// Unauthenticated health check for the hosting platform's monitor.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.use('/api/auth', authRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/board', requireAuth, boardRouter);
app.use('/api/messages', requireAuth, messagesRouter);
app.use('/api/chat', requireAuth, chatRouter);

// Static file serving + the login-gated app shell only matter for local dev /
// non-Netlify hosts: on Netlify, static files under public/ are served
// directly by the CDN and never reach this Express app, so the actual gate
// there is client-side (public/js/app.js redirects to /login.html when
// /api/auth/me has no user — app.html itself holds no sensitive data).
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function serveApp(req, res) {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
}

app.get('/', serveApp);
app.get('/app.html', serveApp);

// Centralized error handler so a rejected promise in a route becomes a JSON
// 500 instead of an unhandled crash.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

module.exports = app;
