const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_ROLES = ['admin', 'manager', 'worker'];

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
}

// Any signed-in user can see the roster (needed for @mention autocomplete / presence).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY LOWER(display_name)');
    res.json({ users: rows.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

// Only admins can create accounts and assign roles.
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { username, password, displayName, role } = req.body || {};
    if (
      typeof username !== 'string' || !username.trim() ||
      typeof password !== 'string' || password.length < 8 ||
      typeof displayName !== 'string' || !displayName.trim() ||
      !VALID_ROLES.includes(role)
    ) {
      return res.status(400).json({ error: 'username, password (min 8 chars), displayName, and a valid role are required.' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [normalizedUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const hash = bcrypt.hashSync(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [normalizedUsername, displayName.trim(), hash, role]
    );

    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Only admins can change a user's role.
router.patch('/:id/role', requireRole('admin'), async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.role === 'admin' && role !== 'admin') {
      const { rows: adminRows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
      if (adminRows[0].n <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last remaining admin.' });
      }
    }

    const { rows: updatedRows } = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING *', [role, id]);
    res.json({ user: publicUser(updatedRows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
