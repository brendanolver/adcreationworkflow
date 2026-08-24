const express = require('express');
const path = require('path');

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WNDRR Ads Dashboard running on http://localhost:${PORT}`);
});
