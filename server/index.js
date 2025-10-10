// path: server/index.js
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

app.options(/.*/, cors());

app.use(express.json());

app.use(express.static(path.join(__dirname, '..')));

// ---------- Paths ----------
const CONTENT_PATH  = path.resolve(__dirname, 'content.json');   // server/content.json
const LIKES_PATH    = path.resolve(__dirname, 'likes.json');     // server/likes.json
const USERS_PATH    = path.resolve(__dirname, 'users.json');     // server/users.json
const PROFILES_PATH = path.resolve(__dirname, 'profiles.json');  // server/profiles.json

// ---------- Helpers ----------
async function writeJsonAtomic(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}
async function readJSON(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function ensureFileJSON(filePath, fallbackValue) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonAtomic(filePath, fallbackValue);
  }
}
function stripPriv(it) {
  const { _title, _genres, _type, _year, _likes, ...pub } = it;
  return { ...pub, likes: typeof pub.likes === 'number' ? pub.likes : (_likes || 0) };
}

// ---------- In-memory cache ----------
let CATALOG = [];
let LIKES_MAP = {}; // { [profileId]: string[] }

// ---------- Init loaders ----------
async function loadCatalog() {
  const exists = await readJSON(CONTENT_PATH, null);
  const data = exists ?? [];
  const arr = Array.isArray(data) ? data
            : Array.isArray(data?.items) ? data.items
            : Array.isArray(data?.catalog) ? data.catalog
            : Array.isArray(data?.data) ? data.data
            : Array.isArray(Object.values(data || {}).filter(Array.isArray).flat())
              ? Object.values(data || {}).filter(Array.isArray).flat()
              : [];

  CATALOG = arr.map(it => ({
    ...it,
    _title: (it.title || '').toLowerCase(),
    _genres: (Array.isArray(it.genres) ? it.genres : []).map(g => (g || '').toLowerCase()),
    _type: (it.type || '').toLowerCase(),
    _year: Number(it.year) || null,
    _likes: Number(it.likes) || 0,
  }));
}

async function loadLikes() {
  const data = await readJSON(LIKES_PATH, {});
  for (const pid of Object.keys(data || {})) {
    const arr = Array.isArray(data[pid]) ? data[pid] : [];
    data[pid] = [...new Set(arr.map(String))];
  }
  LIKES_MAP = data || {};
}

// ---------- Users/Profiles store helpers ----------
async function readUsers() { return await readJSON(USERS_PATH, []); }
async function writeUsers(arr) { await writeJsonAtomic(USERS_PATH, arr); }
async function readProfiles() { return await readJSON(PROFILES_PATH, []); }
async function writeProfiles(arr) { await writeJsonAtomic(PROFILES_PATH, arr); }

function validEmail(v) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(String(v || '').trim());
}
function validPassword(pw) { return typeof pw === 'string' && pw.trim().length >= 6; }
function validUsername(name) {
  const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
  return usernameRegex.test(String(name || '').trim());
}

// ---------- Bootstrap files ----------
(async () => {
  await Promise.all([
    ensureFileJSON(USERS_PATH, []),
    ensureFileJSON(PROFILES_PATH, []),
    ensureFileJSON(LIKES_PATH, {}),
    ensureFileJSON(CONTENT_PATH, []) 
  ]);
  await Promise.all([loadCatalog(), loadLikes()]);
})().catch(err => {
  console.error('Failed to initialize server files', err);
  process.exit(1);
});

// ---------- Health ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- Auth ----------
app.post('/api/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (!validUsername(username)) return res.status(400).json({ error: 'Username must be 3-15 characters, letters/numbers/underscores only.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const users = await readUsers();
  if (users.some(u => String(u.email).toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email already registered.' });
  if (users.some(u => String(u.username).toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken.' });

  const newUser = { email, username, password }; 
  users.push(newUser);
  await writeUsers(users);
  console.log(`User ${username} created successfully`);
  res.status(201).json({ message: 'User created.', user: { email, username } });
});

app.post('/api/login', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!validEmail(email)) return res.status(400).json({ error: 'Invalid email.' });
  if (!validPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const users = await readUsers();
  const user = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email not found.' });
  if (String(user.password) !== password) return res.status(401).json({ error: 'Incorrect password.' });

  console.log(`User ${user.username} logged in successfully`);
  res.json({ message: 'Login successful.', user: { email: user.email, username: user.username } });
});

// ---------- Profiles ----------
app.get('/api/profiles', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'User ID is required.' });

  try {
    const allProfiles = await readProfiles();
    const userProfiles = allProfiles.filter(p => p.userId === userId);
    console.log(`Retrieved ${userProfiles.length} profiles for user: ${userId}`);
    res.json(userProfiles);
  } catch (e) {
    console.error('Error reading profiles:', e);
    res.status(500).json({ error: 'Failed to load profiles.' });
  }
});

app.post('/api/profiles', async (req, res) => {
  const { userId, name, avatar } = req.body;
  if (!userId || !name || !avatar) return res.status(400).json({ error: 'User ID, name, and avatar are required.' });
  if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
  if (name.trim().length > 20) return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });

  try {
    const allProfiles = await readProfiles();
    const userProfiles = allProfiles.filter(p => p.userId === userId);
    if (userProfiles.length >= 5) return res.status(400).json({ error: 'Maximum of 5 profiles per user.' });
    if (userProfiles.some(p => p.name.toLowerCase() === name.trim().toLowerCase()))
      return res.status(409).json({ error: 'Profile name already exists.' });

    const maxId = allProfiles.length > 0 ? Math.max(...allProfiles.map(p => p.id || 0)) : 0;
    const newProfile = {
      id: maxId + 1,
      userId,
      name: name.trim(),
      avatar,
      createdAt: new Date().toISOString(),
      likedContent: []
    };
    allProfiles.push(newProfile);
    await writeProfiles(allProfiles);
    console.log(`Profile "${newProfile.name}" created for user: ${userId}`);
    res.status(201).json({ message: 'Profile created successfully.', profile: newProfile });
  } catch (e) {
    console.error('Error creating profile:', e);
    res.status(500).json({ error: 'Failed to create profile.' });
  }
});

// ---------- Search ----------
app.get('/api/search', (_req, res) => {
  const q        = (_req.query.q || '').trim().toLowerCase();
  const genre    = (_req.query.genre || '').trim().toLowerCase();
  const type     = (_req.query.type || '').trim().toLowerCase();
  const yFromStr = (_req.query.year_from || '').trim();
  const yToStr   = (_req.query.year_to || '').trim();
  const sort     = (_req.query.sort || '').trim().toLowerCase();
  const limit    = Math.min(Math.max(parseInt(_req.query.limit || '30', 10) || 30, 1), 200);

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
app.get('/api/content', async (req, res) => {
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

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
