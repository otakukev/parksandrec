const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function serializePost(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    author: { id: row.user_id, displayName: row.display_name, role: row.author_role },
  };
}

const SELECT_POSTS = `
  SELECT bp.*, u.display_name, u.role AS author_role
  FROM board_posts bp
  JOIN users u ON u.id = bp.user_id
  ORDER BY bp.created_at DESC, bp.id DESC
`;

// All signed-in users (any role) can read the board.
router.get('/', (req, res) => {
  const rows = db.prepare(SELECT_POSTS).all();
  res.json({ posts: rows.map(serializePost) });
});

// Only managers and admins can post announcements.
router.post('/', requireRole('admin', 'manager'), (req, res) => {
  const { title, content } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Title and content are required.' });
  }

  const info = db.prepare(
    'INSERT INTO board_posts (user_id, title, content) VALUES (?, ?, ?)'
  ).run(req.session.user.id, title.trim(), content.trim());

  const row = db.prepare(`
    SELECT bp.*, u.display_name, u.role AS author_role
    FROM board_posts bp JOIN users u ON u.id = bp.user_id
    WHERE bp.id = ?
  `).get(info.lastInsertRowid);

  res.status(201).json({ post: serializePost(row) });
});

// Admins, or the manager who authored it, can delete a post.
router.delete('/:id', requireRole('admin', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const post = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });

  if (req.session.user.role !== 'admin' && post.user_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You can only delete your own posts.' });
  }

  db.prepare('DELETE FROM board_posts WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
