const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Running migration ${file}...`);
    await db.query(sql);
  }

  console.log('Migrations complete.');
}

if (require.main === module) {
  runMigrations()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
