const express = require('express');
const pool = require('../db');

const router = express.Router();
const CHANNEL = 'general';
const ONLINE_WINDOW_SECONDS = 15;
const TYPING_WINDOW_SECONDS = 4;

function serializeMessage(row) {
  return {
    id: row.id,
    channel: row.channel,
    content: row.content,
    mentions: row.mentions || [],
    createdAt: row.created_at,
    author: { id: row.user_id, displayName: row.display_name, username: row.username, role: row.author_role },
  };
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

// Send a chat message.
router.post('/messages', async (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) {
      return res.status(400).json({ error: 'Message must be 1-2000 characters.' });
    }

    const { rows: userRows } = await pool.query('SELECT username FROM users');
    const knownUsernames = new Set(userRows.map((u) => u.username));
    const mentions = extractMentions(content, knownUsernames);

    const { rows } = await pool.query(
      'INSERT INTO messages (channel, user_id, content, mentions) VALUES ($1, $2, $3, $4) RETURNING id',
      [CHANNEL, req.session.user.id, content, JSON.stringify(mentions)]
    );

    // Sending a message implies you're not typing anymore.
    await pool.query(
      `INSERT INTO typing_status (user_id, channel, is_typing, updated_at) VALUES ($1, $2, false, now())
       ON CONFLICT (user_id) DO UPDATE SET is_typing = false, updated_at = now()`,
      [req.session.user.id, CHANNEL]
    );

    const { rows: msgRows } = await pool.query(
      `SELECT m.*, u.display_name, u.username, u.role AS author_role
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.id = $1`,
      [rows[0].id]
    );

    res.status(201).json({ message: serializeMessage(msgRows[0]) });
  } catch (err) {
    next(err);
  }
});

// Set/clear the current user's typing indicator.
router.post('/typing', async (req, res, next) => {
  try {
    const isTyping = Boolean(req.body?.isTyping);
    await pool.query(
      `INSERT INTO typing_status (user_id, channel, is_typing, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET is_typing = $3, channel = $2, updated_at = now()`,
      [req.session.user.id, CHANNEL, isTyping]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Long-poll-ish endpoint the client hits every couple seconds: returns
// messages newer than afterId, who's typing, and who's online. Also acts as
// this user's presence heartbeat.
router.get('/poll', async (req, res, next) => {
  try {
    const afterId = Number(req.query.afterId) || 0;
    const me = req.session.user;

    await pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [me.id]);

    const [messagesResult, typingResult, onlineResult] = await Promise.all([
      pool.query(
        `SELECT m.*, u.display_name, u.username, u.role AS author_role
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.channel = $1 AND m.id > $2
         ORDER BY m.id ASC
         LIMIT 200`,
        [CHANNEL, afterId]
      ),
      pool.query(
        `SELECT u.id, u.display_name AS "displayName", u.username
         FROM typing_status t JOIN users u ON u.id = t.user_id
         WHERE t.channel = $1 AND t.is_typing = true
           AND t.updated_at > now() - interval '${TYPING_WINDOW_SECONDS} seconds'
           AND t.user_id != $2`,
        [CHANNEL, me.id]
      ),
      pool.query(
        `SELECT id, display_name AS "displayName", username, role
         FROM users
         WHERE last_seen > now() - interval '${ONLINE_WINDOW_SECONDS} seconds'
         ORDER BY LOWER(display_name)`
      ),
    ]);

    res.json({
      messages: messagesResult.rows.map(serializeMessage),
      typingUsers: typingResult.rows,
      online: onlineResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
