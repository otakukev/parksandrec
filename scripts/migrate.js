// One-time setup: creates the schema and seeds an initial admin account if
// the users table is empty. Run with: npm run migrate
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[migrate] Schema is up to date.');

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'changeme123';
    const hash = bcrypt.hashSync(password, 12);
    await pool.query(
      'INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, $4)',
      [username, 'Admin', hash, 'admin']
    );
    console.log(`[migrate] Seeded initial admin account "${username}". Set ADMIN_USERNAME/ADMIN_PASSWORD env vars to customize, and change the password after first login.`);
  } else {
    console.log('[migrate] Users already exist, skipping admin seed.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
