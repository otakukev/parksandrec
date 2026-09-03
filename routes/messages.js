const express = require('express');
const db = require('../db');

const router = express.Router();

function serializeMessage(row) {
  return {
    id: row.id,
    channel: row.channel,
    content: row.content,
    mentions: JSON.parse(row.mentions || '[]'),
    createdAt: row.created_at,
    author: { id: row.user_id, displayName: row.display_name, username: row.username, role: row.author_role },
  };
}

const SELECT_MESSAGES = `
  SELECT m.*, u.display_name, u.username, u.role AS author_role
  FROM messages m
  JOIN users u ON u.id = m.user_id
  WHERE m.channel = ?
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT ?
`;

// Recent chat history for a channel (default: general), newest-first from the DB, returned oldest-first for display.
router.get('/', (req, res) => {
  const channel = typeof req.query.channel === 'string' && req.query.channel.trim() ? req.query.channel.trim() : 'general';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = db.prepare(SELECT_MESSAGES).all(channel, limit);
  res.json({ messages: rows.reverse().map(serializeMessage) });
});

module.exports = router;
