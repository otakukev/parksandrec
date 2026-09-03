const express = require('express');
const pool = require('../db');
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
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(SELECT_POSTS);
    res.json({ posts: rows.map(serializePost) });
  } catch (err) {
    next(err);
  }
});

// Only managers and admins can post announcements.
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { title, content } = req.body || {};
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Title and content are required.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO board_posts (user_id, title, content) VALUES ($1, $2, $3) RETURNING id',
      [req.session.user.id, title.trim(), content.trim()]
    );

    const { rows: postRows } = await pool.query(
      `SELECT bp.*, u.display_name, u.role AS author_role
       FROM board_posts bp JOIN users u ON u.id = bp.user_id
       WHERE bp.id = $1`,
      [rows[0].id]
    );

    res.status(201).json({ post: serializePost(postRows[0]) });
  } catch (err) {
    next(err);
  }
});

// Admins, or the manager who authored it, can delete a post.
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM board_posts WHERE id = $1', [id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    if (req.session.user.role !== 'admin' && post.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'You can only delete your own posts.' });
    }

    await pool.query('DELETE FROM board_posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
