const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

if (fs.existsSync(path.join(__dirname, '.env'))) {
  process.loadEnvFile(path.join(__dirname, '.env'));
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres database ' +
    '(e.g. a Netlify DB / Neon connection string), then run "npm run migrate".'
  );
}

// Hosted Postgres (Neon, Supabase, etc.) requires SSL; a local dev database usually doesn't
// support it. Set DATABASE_SSL=false in .env for local development.
const useSSL = process.env.DATABASE_SSL !== 'false';

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX) || 5,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err);
});

module.exports = pool;
