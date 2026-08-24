const express = require('express');
const path = require('path');
const { runMigrations } = require('./src/migrate');

const app = express();
app.use(express.json());

app.use('/api/categories', require('./src/routes/categories'));
app.use('/api/mappings', require('./src/routes/mappings'));
app.use('/api/promotions', require('./src/routes/promotions'));
app.use('/api/styles', require('./src/routes/styles'));
app.use('/api/dashboard', require('./src/routes/dashboard'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3333;

// Run migrations on boot rather than relying on a separate deploy-time
// command -- keeps the app self-contained regardless of how the platform
// invokes the start command (nixpacks.toml's [start] override isn't always
// honored, e.g. on Railway it fell back to `npm start`).
runMigrations()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`WNDRR Ads Dashboard running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Migration failed, not starting server:', err);
    process.exit(1);
  });
