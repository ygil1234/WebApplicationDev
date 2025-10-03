// server/index.js
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); 
    const ok = /^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    cb(null, ok);
  }
}));

app.use(express.static(path.join(__dirname, '..')));

let CATALOG = [];

async function loadCatalog() {
  const p = path.resolve(__dirname, 'content.json'); 
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);

  CATALOG = data.map(it => ({
    ...it,
    _title: (it.title || '').toLowerCase(),
    _genres: (Array.isArray(it.genres) ? it.genres : []).map(g => (g || '').toLowerCase()),
    _type: (it.type || '').toLowerCase(),
    _year: Number(it.year) || null,
    _likes: Number(it.likes) || 0,
  }));
}
loadCatalog().catch(err => {
  console.error('Failed to load content.json', err);
  process.exit(1);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/search', (req, res) => {
  const q        = (req.query.q || '').trim().toLowerCase();
  const genre    = (req.query.genre || '').trim().toLowerCase();
  const type     = (req.query.type || '').trim().toLowerCase();
  const yFromStr = (req.query.year_from || '').trim();
  const yToStr   = (req.query.year_to || '').trim();
  const sort     = (req.query.sort || '').trim().toLowerCase(); 
  const limit    = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);

  const yFrom = yFromStr ? Number(yFromStr) : null;
  const yTo   = yToStr   ? Number(yToStr)   : null;

  if ((yFromStr && Number.isNaN(yFrom)) || (yToStr && Number.isNaN(yTo))) {
    return res.status(400).json({ error: 'Invalid year range' });
  }
  if (yFrom && yTo && yFrom > yTo) {
    return res.status(400).json({ error: 'year_from must be <= year_to' });
  }

  let results = CATALOG.filter(it => {
    if (q) {
      const inTitle  = it._title.includes(q);
      const inGenres = it._genres.some(g => g.includes(q));
      if (!inTitle && !inGenres) return false;
    }
    if (genre && !it._genres.includes(genre)) return false;
    if (type && it._type !== type) return false;
    if (yFrom && (it._year == null || it._year < yFrom)) return false;
    if (yTo   && (it._year == null || it._year > yTo)) return false;
    return true;
  });

  if (sort === 'alpha') {
    results.sort((a, b) => a._title.localeCompare(b._title, 'en', { sensitivity: 'base' }));
  } else {
    results.sort((a, b) => (b._likes - a._likes) || a._title.localeCompare(b._title, 'en', { sensitivity: 'base' }));
  }

  const sliced = results.slice(0, limit);

  return res.json({
    query: { q, genre, type, year_from: yFrom, year_to: yTo, sort: sort || 'popular', limit },
    count: results.length,
    results: sliced.map(({ _title, _genres, _type, _year, _likes, ...pub }) => pub)
  });
});

app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});