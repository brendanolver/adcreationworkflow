const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL not set -- database calls will fail until it is configured.');
}

// Default to no SSL -- most managed Postgres reached over a private network
// (e.g. Railway's internal DATABASE_URL) doesn't support it, and forcing a
// handshake there just hangs/fails the connection. Opt in explicitly via
// PGSSL=true or a `sslmode=require` connection string for hosts that need it.
const useSSL = process.env.PGSSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
