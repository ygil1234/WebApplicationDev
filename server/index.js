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

app.use(express.json());

// Serve the project root statically
app.use(express.static(path.join(__dirname, '..')));

// ---------- Paths ----------
const CONTENT_PATH = path.resolve(__dirname, 'content.json');
const LIKES_PATH   = path.resolve(__dirname, 'likes.json');

// ---------- In-memory cache ----------
let CATALOG = [];
let LIKES_MAP = {}; // { [profileId]: string[] of contentId }

// ---------- Helpers ----------
async function writeJsonAtomic(filePath, obj) {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

async function loadCatalog() {
  const raw = await fs.readFile(CONTENT_PATH, 'utf8');
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

async function loadLikes() {
  try {
    const raw = await fs.readFile(LIKES_PATH, 'utf8');
    const data = JSON.parse(raw);
    // normalize to arrays of strings
    Object.keys(data || {}).forEach(pid => {
      const arr = Array.isArray(data[pid]) ? data[pid] : [];
      data[pid] = [...new Set(arr.map(String))];
    });
    LIKES_MAP = data || {};
  } catch (e) {
    // create empty likes file if missing
    LIKES_MAP = {};
    await writeJsonAtomic(LIKES_PATH, LIKES_MAP);
  }
}

// Initial load
Promise.all([loadCatalog(), loadLikes()]).catch(err => {
  console.error('Failed to initialize server files', err);
  process.exit(1);
});

// ---------- Health ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- Search ----------
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

// ---------- Content ----------
app.get('/api/content', (req, res) => {
  const profileId = (req.query.profileId || '').trim();
  const term      = (req.query.search || '').trim().toLowerCase();
  const alpha     = (req.query.alpha || '') === '1';

  const likedSet = new Set(Array.isArray(LIKES_MAP[profileId]) ? LIKES_MAP[profileId] : []);

  let out = CATALOG.map(it => ({
    ...stripPriv(it),
    liked: likedSet.has(String(it.id))
  }));

  if (term) {
    out = out.filter(it => {
      const t = (it.title || '').toLowerCase();
      const g = Array.isArray(it.genres) ? it.genres.map(x => (x || '').toLowerCase()) : [];
      const byTitle = t.includes(term);
      const byGenre = g.some(x => x.includes(term));
      const byType  = (it.type || '').toLowerCase().includes(term);
      const byYear  = String(it.year || '').includes(term);
      return byTitle || byGenre || byType || byYear;
    });
  }
  if (alpha) {
    out.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  }

  return res.json(out);
});

// ---------- Likes API ----------
app.post('/api/likes/toggle', async (req, res) => {
  try {
    const { profileId, contentId, like } = req.body || {};
    if (!profileId || !contentId || typeof like !== 'boolean') {
      return res.status(400).json({ error: 'profileId, contentId and like are required' });
    }

    const idx = CATALOG.findIndex(c => String(c.id) === String(contentId));
    if (idx === -1) return res.status(404).json({ error: 'Content not found' });

    const set = new Set(Array.isArray(LIKES_MAP[profileId]) ? LIKES_MAP[profileId].map(String) : []);

    const already = set.has(String(contentId));
    let changed = false;

    if (like && !already) {
      set.add(String(contentId));
      CATALOG[idx]._likes = Math.max(0, (CATALOG[idx]._likes || 0) + 1);
      CATALOG[idx].likes  = Math.max(0, (Number(CATALOG[idx].likes) || 0) + 1);
      changed = true;
    } else if (!like && already) {
      set.delete(String(contentId));
      CATALOG[idx]._likes = Math.max(0, (CATALOG[idx]._likes || 0) - 1);
      CATALOG[idx].likes  = Math.max(0, (Number(CATALOG[idx].likes) || 0) - 1);
      changed = true;
    }

    LIKES_MAP[profileId] = Array.from(set);

    if (changed) {
      const publicCatalog = CATALOG.map(stripPriv);
      await Promise.all([
        writeJsonAtomic(LIKES_PATH, LIKES_MAP),
        writeJsonAtomic(CONTENT_PATH, publicCatalog)
      ]);
    }

    return res.json({
      liked: set.has(String(contentId)),
      likes: CATALOG[idx].likes
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update like' });
  }
});

// ---------- Utils ----------
function stripPriv(it) {
  const { _title, _genres, _type, _year, _likes, ...pub } = it;
  return { ...pub, likes: typeof pub.likes === 'number' ? pub.likes : (_likes || 0) };
}

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
