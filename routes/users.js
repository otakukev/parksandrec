const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_ROLES = ['admin', 'manager', 'worker'];

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
}

// Any signed-in user can see the roster (needed for @mention autocomplete / presence).
router.get('/', (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY display_name COLLATE NOCASE').all();
  res.json({ users: users.map(publicUser) });
});

// Only admins can create accounts and assign roles.
router.post('/', requireRole('admin'), (req, res) => {
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
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(normalizedUsername);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(normalizedUsername, displayName.trim(), hash, role);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(user) });
});

// Only admins can change a user's role.
router.patch('/:id/role', requireRole('admin'), (req, res) => {
  const { role } = req.body || {};
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.role === 'admin' && role !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last remaining admin.' });
    }
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

module.exports = router;
