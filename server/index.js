// server/index.js 
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express    = require('express');
const fs         = require('fs/promises');
const cors       = require('cors');
const mongoose   = require('mongoose');
const sessionLib = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT      = process.env.PORT || 3000;
const NODE_ENV  = process.env.NODE_ENV || 'development';
const IS_PROD   = NODE_ENV === 'production';

// ====== Config ======
const MONGODB_URI    = process.env.MONGODB_URI    || 'mongodb://127.0.0.1:27017/netflix_feed';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret_change_me';
const SEED_CONTENT   = process.env.SEED_CONTENT   === '1';

// ====== CORS & JSON ======
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = /^(http:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      cb(null, ok);
    },
    credentials: true,
  })
);
app.options(/.*/, cors());
app.use(express.json());

// ====== Sessions (install early, with fallback) ======
if (IS_PROD) app.set('trust proxy', 1);

function buildSessionMiddleware() {
  const baseOptions = {
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  };
  try {
    const store = MongoStore.create({ mongoUrl: MONGODB_URI });
    return sessionLib({ ...baseOptions, store });
  } catch (e) {
    console.warn('[session] Falling back to MemoryStore:', e.message);
    return sessionLib(baseOptions);
  }
}
app.use(buildSessionMiddleware());

// ====== DB Connection ======
mongoose.set('strictQuery', true);
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('[mongo] connected'))
  .catch((err) => {
    console.error('[mongo] connection error:', err.message);
  });

mongoose.connection.once('open', () => {
  seedContentIfNeeded();
});

// ====== Schemas & Models ======
const contentSchema = new mongoose.Schema(
  {
    extId:  { type: String, unique: true, index: true }, // e.g. "m7"
    title:  { type: String, required: true },
    year:   Number,
    genres: { type: [String], default: [] },
    likes:  { type: Number, default: 0 },
    cover:  String,
    type:   String, // "Movie" / "Series"
  },
  { timestamps: true }
);
contentSchema.index({ title: 'text' });
contentSchema.index({ genres: 1 });
contentSchema.index({ likes: -1, title: 1 });

const likeSchema = new mongoose.Schema(
  {
    profileId:    { type: String, index: true },
    contentExtId: { type: String, index: true }, // matches Content.extId
  },
  { timestamps: true }
);
likeSchema.index({ profileId: 1, contentExtId: 1 }, { unique: true });

const logSchema = new mongoose.Schema(
  {
    level:     { type: String, enum: ['info','warn','error'], default: 'info' },
    event:     { type: String, required: true },
    userId:    { type: String, default: null },
    profileId: { type: String, default: null },
    details:   { type: Object, default: {} },
  },
  { timestamps: true }
);

const Content = mongoose.models.Content || mongoose.model('Content', contentSchema);
const Like    = mongoose.models.Like    || mongoose.model('Like', likeSchema);
const Log     = mongoose.models.Log     || mongoose.model('Log', logSchema);

Content.init().catch(e => console.warn('[mongo] Content.init index warn:', e.message));
Like.init().catch(e => console.warn('[mongo] Like.init index warn:', e.message));

// ====== Static Front-End ======
app.use(express.static(path.join(__dirname, '..')));

// ====== Health ======
app.get('/api/health', async (req, res) => {
  res.json({ 
    ok: true, 
    env: NODE_ENV, 
    mongo: mongoose.connection.readyState, 
    hasSession: Boolean(req.session),
    sessionUser: req.session?.userId || null 
  });
});

// ====== Helpers ======
function sanitizeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function writeLog({ level = 'info', event, userId = null, profileId = null, details = {} }) {
  try { await Log.create({ level, event, userId, profileId, details }); }
  catch (e) { console.warn('[log] skip:', e.message); }
}

// ====== File-based Users/Profiles (helpers) ======
const DATA_DIR      = path.resolve(__dirname);
const USERS_PATH    = path.join(DATA_DIR, 'users.json');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');

async function readJSON(p, fallback) {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw);
  } catch { return fallback; }
}
async function writeJsonAtomic(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}
async function ensureFileJSON(p, initial) {
  try { await fs.access(p); } catch { await writeJsonAtomic(p, initial); }
}

async function readUsers()      { return await readJSON(USERS_PATH, []); }
async function writeUsers(arr)  { await writeJsonAtomic(USERS_PATH, arr); }
async function readProfiles()   { return await readJSON(PROFILES_PATH, []); }
async function writeProfiles(a) { await writeJsonAtomic(PROFILES_PATH, a); }

// ====== Resolve userId (accept id / username / email / session) ======
async function resolveUserId(userIdOrName, session) {
  let v = String(userIdOrName || '').trim();

  if (!v) {
    if (session?.userId) return String(session.userId);
    if (session?.username) v = String(session.username);
  }
  if (!v) return '';

  try {
    const users = await readUsers();
    const lower = v.toLowerCase();
    const u = users.find(u =>
      String(u.id || '') === v ||
      String(u.username || '').toLowerCase() === lower ||
      String(u.email || '').toLowerCase() === lower
    );
    return u ? String(u.id) : v;
  } catch {
    return v;
  }
}

// ====== Server-side validators (signup/login) ======
const EMAIL_RX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function validEmail(v)    { return EMAIL_RX.test(String(v || '').trim()); }
function validPassword(p) { return typeof p === 'string' && p.trim().length >= 6; }
function validUsername(n) { return /^[A-Za-z0-9_]{3,15}$/.test(String(n || '').trim()); }

// ====== Bootstrap JSON stores for users/profiles ======
(async () => {
  try {
    await ensureFileJSON(USERS_PATH, []);
    await ensureFileJSON(PROFILES_PATH, []);
  } catch (err) {
    console.error('Failed to initialize users/profiles stores', err);
    process.exit(1);
  }
})();

// ====== Auth ======
app.post('/api/signup', async (req, res) => {
  const email    = String(req.body?.email || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!validEmail(email))       return res.status(400).json({ ok:false, error: 'Invalid email.' });
  if (!validUsername(username)) return res.status(400).json({ ok:false, error: 'Username must be 3-15 characters (letters/numbers/underscores).' });
  if (!validPassword(password)) return res.status(400).json({ ok:false, error: 'Password must be at least 6 characters.' });

  const users = await readUsers();
  if (users.some(u => String(u.email).toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ ok:false, error: 'Email already registered.' });
  if (users.some(u => String(u.username).toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ ok:false, error: 'Username already taken.' });

  const newUser = { id: cryptoRandomId(), email, username, password };
  users.push(newUser);
  await writeUsers(users);

  req.session.userId   = newUser.id;
  req.session.username = newUser.username;

  await writeLog({ event: 'signup', userId: newUser.id, details: { email } });
  return res.status(201).json({ ok:true, user: { id: newUser.id, email, username } });
});

app.post('/api/login', async (req, res) => {
  const email    = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');

  if (!validEmail(email))       return res.status(400).json({ ok:false, error: 'Invalid email.' });
  if (!validPassword(password)) return res.status(400).json({ ok:false, error: 'Password must be at least 6 characters.' });

  const users = await readUsers();
  const user  = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
  if (!user)                     return res.status(401).json({ ok:false, error: 'Email not found.' });
  if (String(user.password) !== password)
                                return res.status(401).json({ ok:false, error: 'Incorrect password.' });

  req.session.userId   = user.id;
  req.session.username = user.username;

  await writeLog({ event: 'login', userId: user.id, details: { email } });
  return res.json({ ok:true, user: { id: user.id, email: user.email, username: user.username } });
});

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ====== Profiles ======
app.get('/api/profiles', async (req, res) => {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) return res.status(400).json({ error: 'User ID is required.' });

    const allProfiles  = await readProfiles();
    const userProfiles = allProfiles.filter(p => String(p.userId) === String(resolvedUserId));
    return res.json(userProfiles); 
  } catch (e) {
    console.error('Error reading profiles:', e);
    return res.status(500).json({ error: 'Failed to load profiles.' });
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const userIdResolved = await resolveUserId(req.body?.userId, req.session);
    const name   = String(req.body?.name || '').trim();
    const avatar = String(req.body?.avatar || '').trim();

    if (!userIdResolved || !name || !avatar)
      return res.status(400).json({ error: 'User ID, name, and avatar are required.' });
    if (name.length < 2)
      return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
    if (name.length > 20)
      return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });

    const allProfiles  = await readProfiles();
    const userProfiles = allProfiles.filter(p => String(p.userId) === String(userIdResolved));

    if (userProfiles.length >= 5)
      return res.status(400).json({ error: 'Maximum of 5 profiles per user.' });
    if (userProfiles.some(p => p.name.toLowerCase() === name.toLowerCase()))
      return res.status(409).json({ error: 'Profile name already exists.' });

    const maxId = allProfiles.length > 0 ? Math.max(...allProfiles.map(p => p.id || 0)) : 0;
    const newProfile = {
      id: maxId + 1,
      userId: userIdResolved,   // always store the internal id
      name,
      avatar,
      createdAt: new Date().toISOString(),
      likedContent: []
    };

    allProfiles.push(newProfile);
    await writeProfiles(allProfiles);

    await writeLog({ event: 'profile_create', userId: userIdResolved, details: { profileId: newProfile.id, name } });
    return res.status(201).json(newProfile); 
  } catch (e) {
    console.error('Error creating profile:', e);
    return res.status(500).json({ error: 'Failed to create profile.' });
  }
});

// ====== Feed ======
app.get('/api/feed', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const sort  = String(req.query.sort || 'popular').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);

    const sortSpec = (sort === 'alpha') ? { title: 1 } : { likes: -1, title: 1 };
    const items = await Content.find({}).sort(sortSpec).limit(limit).lean();

    if (!profileId) {
      await writeLog({ event: 'feed', details: { sort, limit, count: items.length } });
      return res.json({ ok: true, items });
    }

    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({ event: 'feed', profileId, details: { sort, limit, count: annotated.length } });
    res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/feed error:', err);
    await writeLog({ level: 'error', event: 'feed', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Search ======
app.get('/api/search', async (req, res) => {
  try {
    const q         = String(req.query.query || '').trim();
    const type      = String(req.query.type || '').trim().toLowerCase();
    const genre     = String(req.query.genre || '').trim().toLowerCase();
    const yFromStr  = String(req.query.year_from || '').trim();
    const yToStr    = String(req.query.year_to   || '').trim();
    const sort      = String(req.query.sort || 'popular').toLowerCase();
    const limit     = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);
    const profileId = String(req.query.profileId || '').trim();

    const yFrom = yFromStr ? Number(yFromStr) : null;
    const yTo   = yToStr   ? Number(yToStr)   : null;
    if ((yFromStr && Number.isNaN(yFrom)) || (yToStr && Number.isNaN(yTo))) {
      return res.status(400).json({ ok: false, error: 'Invalid year range' });
    }
    if (yFrom && yTo && yFrom > yTo) {
      return res.status(400).json({ ok: false, error: 'year_from must be <= year_to' });
    }

    const filter = {};
    if (q)     filter.title  = { $regex: sanitizeRegex(q), $options: 'i' };
    if (type)  filter.type   = new RegExp(`^${sanitizeRegex(type)}$`, 'i');
    if (genre) filter.genres = { $elemMatch: { $regex: new RegExp(sanitizeRegex(genre), 'i') } };
    if (yFrom != null || yTo != null) {
      filter.year = {};
      if (yFrom != null) filter.year.$gte = yFrom;
      if (yTo   != null) filter.year.$lte = yTo;
    }

    const sortSpec = (sort === 'alpha') ? { title: 1 } : { likes: -1, title: 1 };
    const items = await Content.find(filter).sort(sortSpec).limit(limit).lean();

    if (!profileId) {
      await writeLog({ event: 'search', details: { q, type, genre, yFrom, yTo, sort, limit, count: items.length } });
      return res.json({ ok: true, query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit }, items });
    }

    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({ event: 'search', profileId, details: { q, type, genre, yFrom, yTo, sort, limit, count: annotated.length } });
    res.json({ ok: true, query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit }, items: annotated });
  } catch (err) {
    console.error('GET /api/search error:', err);
    await writeLog({ level: 'error', event: 'search', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Likes ======
app.post('/api/likes/toggle', async (req, res) => {
  try {
    const { profileId, contentExtId, like } = req.body || {};
    
    if (!profileId || !contentExtId || typeof like !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'profileId, contentExtId and like are required' });
    }

    const content = await Content.findOne({ extId: contentExtId });
    if (!content) {
      return res.status(404).json({ ok: false, error: 'Content not found' });
    }

    if (like) {
      const created = await Like.updateOne(
        { profileId, contentExtId },
        { $setOnInsert: { profileId, contentExtId } },
        { upsert: true }
      );
      if (created.upsertedCount === 1) {
        await Content.updateOne({ _id: content._id }, { $inc: { likes: 1 } });
      }
      const updated = await Content.findById(content._id, 'likes').lean();
      await writeLog({ event: 'like_toggle', profileId, details: { contentExtId, like: true } });
      return res.json({ ok: true, liked: true, likes: updated.likes });
    } else {
      const removed = await Like.deleteOne({ profileId, contentExtId });
      if (removed.deletedCount === 1) {
        await Content.updateOne({ _id: content._id }, { $inc: { likes: -1 } });
      }
      const updated = await Content.findById(content._id, 'likes').lean();
      await writeLog({ event: 'like_toggle', profileId, details: { contentExtId, like: false } });
      return res.json({ ok: true, liked: false, likes: Math.max(0, updated.likes) });
    }
  } catch (err) {
    console.error('POST /api/likes/toggle error:', err);
    await writeLog({ level: 'error', event: 'like_toggle', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Failed to update like' });
  }
});

// ====== Recommendations ======
app.get('/api/recommendations', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    
    if (!profileId) {
      return res.status(400).json({ ok: false, error: 'profileId is required' });
    }

    const likedDocs = await Like.find({ profileId }, 'contentExtId').lean();
    const likedIds  = likedDocs.map(l => l.contentExtId);
    
    if (likedIds.length === 0) {
      const popular = await Content.find({}).sort({ likes: -1, title: 1 }).limit(limit).lean();
      const annotated = popular.map(i => ({ ...i, liked: false }));
      await writeLog({ event: 'recommendations', profileId, details: { topGenres: [], out: annotated.length, note: 'no_likes_yet' } });
      return res.json({ ok: true, items: annotated });
    }

    const likedContents = await Content.find({ extId: { $in: likedIds } }, 'genres').lean();

    const freq = new Map();
    for (const c of likedContents) for (const g of c.genres || []) freq.set(g, (freq.get(g) || 0) + 1);
    const topGenres = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([g])=>g);

    const baseFilter = topGenres.length ? { genres: { $in: topGenres } } : {};
    const candidates = await Content.find({ ...baseFilter, extId: { $nin: likedIds } })
      .sort({ likes: -1, title: 1 })
      .limit(limit)
      .lean();

    const annotated = candidates.map(i => ({ ...i, liked: false }));
    await writeLog({ event: 'recommendations', profileId, details: { topGenres, out: annotated.length } });
    res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/recommendations error:', err);
    await writeLog({ level: 'error', event: 'recommendations', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Logout ======
app.post('/api/logout', async (req, res) => {
  await writeLog({ event: 'logout', details: {} });
  req.session?.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

// ====== Seed from content.json  ======
async function seedContentIfNeeded() {
  if (!SEED_CONTENT) return;
  try {
    const candidates = [
      path.resolve(__dirname, 'content.json'),
      path.resolve(process.cwd(), 'server/content.json'),
      path.resolve(process.cwd(), 'content.json'),
    ];

    let raw = null, usedPath = null;
    for (const p of candidates) {
      try { raw = await fs.readFile(p, 'utf-8'); usedPath = p; break; } catch {}
    }
    if (!raw) throw new Error('content.json not found in server/ or project root');

    const data = JSON.parse(raw);
    let arr =
      Array.isArray(data) ? data :
      (data && typeof data === 'object' && Array.isArray(data.items))   ? data.items   :
      (data && typeof data === 'object' && Array.isArray(data.catalog)) ? data.catalog :
      (data && typeof data === 'object' && Array.isArray(data.data))    ? data.data    :
      (data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null);

    if (!Array.isArray(arr)) throw new Error('content.json must be/contain an array');

    const toDoc = (it) => {
      const title = it.title || it.name || 'Untitled';
      const extId = String(it.id ?? title).trim();
      const genres = Array.isArray(it.genres) ? it.genres
                    : Array.isArray(it.genre)  ? it.genre
                    : (typeof it.genre === 'string'
                        ? it.genre.split(',').map(s => s.trim()).filter(Boolean)
                        : []);
      return {
        extId,
        title,
        year: Number(it.year ?? it.releaseYear ?? '') || undefined,
        genres,
        likes: Number.isFinite(it.likes) ? Number(it.likes) : 0,
        cover: it.cover || it.poster || it.image || it.img || '',
        type: it.type || (it.seasons ? 'Series' : 'Movie'),
      };
    };

    let inserted = 0, updated = 0, skipped = 0;
    for (const it of arr) {
      const doc = toDoc(it);
      if (!doc.extId || !doc.title) { skipped++; continue; }

      const upsertRes = await Content.updateOne(
        { extId: doc.extId },
        { $setOnInsert: doc },
        { upsert: true }
      );

      if (upsertRes.upsertedCount === 1) {
        inserted++;
      } else {
        const updRes = await Content.updateOne(
          { extId: doc.extId },
          { $set: { title: doc.title, year: doc.year, genres: doc.genres, cover: doc.cover, type: doc.type } }
        );
        inserted += 0;
        updated += (updRes.modifiedCount || 0);
      }
    }

    const total = await Content.countDocuments();
    console.log(`[seed] from ${usedPath} → inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}, total: ${total}`);
  } catch (err) {
    console.warn('[seed] skip:', err.message);
  }
}

// ====== Root ======
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'feed.html'));
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [${NODE_ENV}]`);
});
