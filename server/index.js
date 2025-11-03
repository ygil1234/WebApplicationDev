// server/index.js 
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express    = require('express');
const fs         = require('fs/promises');
const cors       = require('cors');
const mongoose   = require('mongoose');
const sessionLib = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt     = require('bcryptjs');
const multer     = require('multer'); 
const axios      = require('axios');  

const app = express();
const PORT      = process.env.PORT || 3000;
const NODE_ENV  = process.env.NODE_ENV || 'development';
const IS_PROD   = NODE_ENV === 'production';

// ====== Config ======
const MONGODB_URI    = process.env.MONGODB_URI    || 'mongodb://127.0.0.1:27017/netflix_feed';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret_change_me';
const SEED_CONTENT   = process.env.SEED_CONTENT   === '1';
const ROW_SCROLL_STEP_RAW = Number.parseInt(process.env.ROW_SCROLL_STEP ?? '5', 10);
const ROW_SCROLL_STEP = Number.isFinite(ROW_SCROLL_STEP_RAW) && ROW_SCROLL_STEP_RAW > 0
  ? ROW_SCROLL_STEP_RAW
  : 5;
const OMDB_API_KEY   = process.env.OMDB_API_KEY;
const CONTENT_JSON_CANDIDATES = [
  path.resolve(__dirname, 'content.json'),
  path.resolve(process.cwd(), 'server/content.json'),
  path.resolve(process.cwd(), 'content.json'),
];

// ====== CORS & JSON ======
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const ok = /^(http:\/\/)?(localhost|127\.0\.0.1)(:\d+)?$/.test(origin);
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
    
    plot:       { type: String },
    director:   { type: String },
    actors:     { type: [String], default: [] },
    rating:     { type: String }, // e.g. "8.8/10"
    ratingValue:{ type: Number, default: null },
    imagePath:  { type: String }, 
    videoPath:  { type: String }, 
    episodes:   { 
      type: [
        new mongoose.Schema({
          season:     { type: Number, required: true },
          episode:    { type: Number, required: true },
          title:      { type: String, default: '' },
          videoPath:  { type: String, required: true },
          durationSec:{ type: Number, default: 0 },
        }, { _id: false })
      ],
      default: []
    },
  },
  { timestamps: true }
);
contentSchema.index({ title: 'text' });
contentSchema.index({ genres: 1 });
contentSchema.index({ likes: -1, title: 1 });
contentSchema.index({ ratingValue: -1, likes: -1 });

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

const userSchema = new mongoose.Schema(
  {
    email:    { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true }, // will hold bcrypt hash
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Content = mongoose.models.Content || mongoose.model('Content', contentSchema);
const Like    = mongoose.models.Like    || mongoose.model('Like', likeSchema);
const Log     = mongoose.models.Log     || mongoose.model('Log', logSchema);

const profileSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    name:      { type: String, required: true },
    avatar:    { type: String, required: true },
    likedContent: { type: [String], default: [] },
  },
  { timestamps: true }
);
profileSchema.index({ userId: 1, name: 1 }, { unique: true });

const Profile = mongoose.models.Profile || mongoose.model('Profile', profileSchema);

User.init().catch(e => console.warn('[mongo] User.init index warn:', e.message));
Content.init().catch(e => console.warn('[mongo] Content.init index warn:', e.message));
Like.init().catch(e => console.warn('[mongo] Like.init index warn:', e.message));

// ====== Watch Progress Schema ======
const watchProgressSchema = new mongoose.Schema(
  {
    profileId:    { type: String, index: true, required: true },
    contentExtId: { type: String, index: true, required: true },
    season:       { type: Number, default: null },
    episode:      { type: Number, default: null },
    positionSec:  { type: Number, default: 0 },
    durationSec:  { type: Number, default: 0 },
    completed:    { type: Boolean, default: false },
  },
  { timestamps: true }
);
watchProgressSchema.index({ profileId: 1, contentExtId: 1, season: 1, episode: 1 }, { unique: true });

const WatchProgress = mongoose.models.WatchProgress || mongoose.model('WatchProgress', watchProgressSchema);

// ====== Static Front-End ======
app.use(express.static(path.join(__dirname, '..')));
// Static uploads with explicit headers for videos (ensure inline playback)
const uploadsDir = path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (/\.mp4$/i.test(filePath)) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', 'inline');
    }
  }
}));


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
app.get('/api/debug/session', (req, res) => {
  res.json({
    hasSession: Boolean(req.session),
    userId: req.session?.userId,
    username: req.session?.username,
    sessionID: req.sessionID,
    cookies: req.headers.cookie
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    scrollStep: ROW_SCROLL_STEP,
  });
});

// ====== Helpers ======
function sanitizeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function parsePositiveInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
async function writeLog({ level = 'info', event, userId = null, profileId = null, details = {} }) {
  try { await Log.create({ level, event, userId, profileId, details }); }
  catch (e) { console.warn('[log] skip:', e.message); }
}

// ====== Seed content fallback cache (for missing cover/imagePath) ======
let __seedCache = null; // Map extId -> item from server/content.json
async function loadSeedCache() {
  if (__seedCache) return __seedCache;
  try {
    const candidates = [
      path.resolve(__dirname, 'content.json'),
      path.resolve(process.cwd(), 'server/content.json'),
      path.resolve(process.cwd(), 'content.json'),
    ];
    let raw = null;
    for (const p of candidates) { try { raw = await fs.readFile(p, 'utf-8'); break; } catch {} }
    if (!raw) { __seedCache = new Map(); return __seedCache; }
    const data = JSON.parse(raw);
    const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : []);
    const map = new Map();
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const id = String(it.id ?? it.extId ?? it.title ?? '').trim();
        if (!id) continue;
        map.set(id, it);
      }
    }
    __seedCache = map;
  } catch {
    __seedCache = new Map();
  }
  return __seedCache;
}
async function getSeedItem(extId) {
  if (!extId) return null;
  const cache = await loadSeedCache();
  return cache.get(String(extId)) || null;
}

function isHttpUrl(u) {
  return /^https?:\/\//i.test(String(u || ''));
}

async function resolveCoverForDoc(doc) {
  // Prefer provided cover/imagePath if valid; otherwise, fall back to seed cover
  const pick = (doc && (doc.cover || doc.imagePath)) ? (doc.cover || doc.imagePath) : '';
  const candidate = String(pick || '').trim();
  // If remote URL, trust it
  if (candidate && isHttpUrl(candidate)) return candidate;
  // If relative asset under IMG/, keep as-is
  if (/^\/?IMG\//i.test(candidate)) return candidate;
  // If it's a local path (e.g., /uploads/...), verify exists; else, fallback
  if (candidate) {
    try {
      const rel = candidate.replace(/^\/+/, '');
      const abs = path.join(__dirname, '..', rel);
      await fs.access(abs);
      return candidate; // existing file
    } catch {
      // will try seed fallback below
    }
  }
  // Seed fallback
  try {
    const seed = await getSeedItem(doc?.extId || doc?.id || '');
    const fb = seed?.cover || seed?.poster || seed?.image || seed?.img || '';
    if (fb) return fb;
  } catch {}
  return candidate; // may be empty; frontend will handle gracefully
}

async function findMostRecentVideoUpload() {
  try {
    const dir = path.join(__dirname, '..', 'uploads', 'videos');
    const files = await fs.readdir(dir);
    const mp4s = files.filter(f => /\.mp4$/i.test(f));
    if (!mp4s.length) return null;
    const stats = await Promise.all(mp4s.map(async f => ({ f, s: await fs.stat(path.join(dir, f)) })));
    stats.sort((a,b) => b.s.mtimeMs - a.s.mtimeMs);
    return `/uploads/videos/${stats[0].f}`;
  } catch { return null; }
}

// ====== Authentication Middleware ======
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }
  next();
}
async function requireAdmin(req, res, next) {
  try {
    if (req.session?.username === 'admin' && req.session?.userId === 'admin-user-id') {
      return next();
    }

    const user = await User.findById(req.session.userId, 'username').lean();
    if (user && user.username === 'admin') {
      return next();
    }

    await writeLog({ 
      level: 'warn', 
      event: 'admin_access_denied', 
      userId: req.session.userId,
      details: { username: user?.username || 'unknown' } 
    });
    return res.status(403).json({ ok: false, error: 'Forbidden: Admin access required.' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Server error during auth check.' });
  }
}

// ====== File-based Users/Profiles (helpers) ======
const DATA_DIR      = path.resolve(__dirname);

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

// ====== Resolve userId (accept id / username / email / session) ======
async function resolveUserId(userIdOrName, session) {
  let v = String(userIdOrName || '').trim();

  if (!v) {
    if (session?.userId) return String(session.userId);
    if (session?.username) v = String(session.username);
  }
  if (!v) return '';

  if (/^[0-9a-fA-F]{24}$/.test(v)) return v;

  const re = new RegExp(`^${sanitizeRegex(v)}$`, 'i');
  const u = await User.findOne({ $or: [{ email: re }, { username: re }] }, '_id').lean();
  return u ? String(u._id) : '';
}

// ====== Server-side validators (signup/login) ======
const EMAIL_RX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function validEmail(v)    { return EMAIL_RX.test(String(v || '').trim()); }
function validPassword(p, username = '') { 
  if (String(username).toLowerCase() === 'admin' && p === 'admin') return true;
  return typeof p === 'string' && p.trim().length >= 6; 
}
function validUsername(n) { return /^[A-Za-z0-9_]{3,15}$/.test(String(n || '').trim()); }

// ====== Auth ======
app.post('/api/signup', async (req, res) => {
  try {
    const email    = String(req.body?.email || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!validEmail(email))       return res.status(400).json({ ok:false, error: 'Invalid email.' });
    if (!validUsername(username)) return res.status(400).json({ ok:false, error: 'Username must be 3-15 characters (letters/numbers/underscores).' });
    if (!validPassword(password, username)) return res.status(400).json({ ok:false, error: 'Password must be at least 6 characters (unless admin/admin).' });

    // Uniqueness checks (case-insensitive)
    const emailExists = await User.exists({ email: new RegExp(`^${sanitizeRegex(email)}$`, 'i') });
    if (emailExists) return res.status(409).json({ ok:false, error: 'Email already registered.' });

    const usernameExists = await User.exists({ username: new RegExp(`^${sanitizeRegex(username)}$`, 'i') });
    if (usernameExists) return res.status(409).json({ ok:false, error: 'Username already taken.' });

    // Create & save – bcrypt happens in userSchema.pre('save')
    const user = new User({ email, username, password });
    await user.save();

    // Session
    req.session.userId   = String(user._id);
    req.session.username = user.username;

    await writeLog({ event: 'signup', userId: String(user._id), details: { email } });

    return res.status(201).json({
      ok: true,
      user: { id: String(user._id), email: user.email, username: user.username }
    });
  } catch (err) {
    // Handle duplicate key race conditions cleanly
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({ ok:false, error: `${field.charAt(0).toUpperCase() + field.slice(1)} already in use.` });
    }
    console.error('POST /api/signup error:', err);
    await writeLog({ level: 'error', event: 'signup', details: { error: err.message } });
    return res.status(500).json({ ok:false, error: 'Server error' });
  }
});

// ====== Admin Login (Special Case) ======
app.post('/api/admin-login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (email === 'admin' && password === 'admin') {
      req.session.userId = 'admin-user-id';
      req.session.username = 'admin';

      await writeLog({ event: 'admin_login', success: true, details: { email } });

      return res.json({
        ok: true,
        user: { id: 'admin-user-id', email: 'admin', username: 'admin' }
      });
    }

    await writeLog({ event: 'admin_login', success: false, details: { email, reason: 'invalid credentials' } });
    return res.status(401).json({ ok: false, error: 'Invalid admin credentials.' });

  } catch (err) {
    console.error('POST /api/admin-login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const loginIdentifier = String(req.body?.email || '').trim(); 
    const password = String(req.body?.password || '');

    if (!loginIdentifier) {
        return res.status(400).json({ ok: false, error: 'Email or Username is required.' });
    }
    const isEmail = validEmail(loginIdentifier);
    
    const query = isEmail 
        ? { email: new RegExp(`^${sanitizeRegex(loginIdentifier)}$`, 'i') }
        : { username: new RegExp(`^${sanitizeRegex(loginIdentifier)}$`, 'i') };

    const user = await User.findOne(query); 
    
    if (!user) {
      const reason = isEmail ? 'Email not found.' : 'Username not found.';
      await writeLog({ event: 'login', success: false, details: { loginIdentifier, reason } });
      return res.status(401).json({ ok: false, error: reason });
    }

    const passwordOk = await user.comparePassword(password);
    if (!passwordOk) {
      await writeLog({ event: 'login', success: false, userId: String(user._id), details: { loginIdentifier, reason: 'bad password' } });
      return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    }

    req.session.userId   = String(user._id);
    req.session.username = user.username;

    await writeLog({ event: 'login', success: true, userId: String(user._id), details: { loginIdentifier } });

    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, username: user.username }
    });

  } catch (err) {
    console.error('POST /api/login error:', err);
    await writeLog({ event: 'login', success: false, details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Profiles ======
app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) return res.status(400).json({ error: 'User ID is required.' });

    const profiles = await Profile.find({ userId: resolvedUserId }).sort({ createdAt: 1 }).lean();

    const payload = profiles.map(p => ({
      id: String(p._id),
      userId: String(p.userId),
      name: p.name,
      avatar: p.avatar,
      likedContent: p.likedContent || [],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));

    await writeLog({ 
      event: 'profiles_load', 
      userId: resolvedUserId, 
      details: { profileCount: payload.length, profileNames: payload.map(p => p.name) } 
    });

    return res.json(payload);
  } catch (e) {
    console.error('Error reading profiles:', e);
    await writeLog({ level: 'error', event: 'profiles_load', details: { error: e.message } });
    return res.status(500).json({ error: 'Failed to load profiles.' });
  }
});

app.post('/api/profiles', requireAuth, async (req, res) => {
  try {
    const userIdResolved = await resolveUserId(req.body?.userId, req.session);
    const name   = String(req.body?.name || '').trim();
    const avatar = String(req.body?.avatar || '').trim();

    if (!userIdResolved || !name || !avatar)
      return res.status(400).json({ error: 'User ID, name, and avatar are required.' });
    if (name.length < 2)  return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
    if (name.length > 20) return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });

    const count = await Profile.countDocuments({ userId: userIdResolved });
    if (count >= 5) return res.status(400).json({ error: 'Maximum of 5 profiles per user.' });

    const dup = await Profile.exists({ userId: userIdResolved, name: new RegExp(`^${sanitizeRegex(name)}$`, 'i') });
    if (dup) return res.status(409).json({ error: 'Profile name already exists.' });

    const doc = await Profile.create({ userId: userIdResolved, name, avatar });

    await writeLog({ 
      event: 'profile_create', 
      userId: userIdResolved, 
      profileId: String(doc._id),
      details: { profileId: String(doc._id), profileName: name, avatar } 
    });

    return res.status(201).json({
      id: String(doc._id),
      userId: String(doc.userId),
      name: doc.name,
      avatar: doc.avatar,
      likedContent: doc.likedContent || [],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  } catch (e) {
    console.error('Error creating profile:', e);
    return res.status(500).json({ error: 'Failed to create profile.' });
  }
});

app.put('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.params.id);
    const userIdResolved = await resolveUserId(req.body?.userId, req.session);
    const name = String(req.body?.name || '').trim();
    const avatar = String(req.body?.avatar || '').trim();

    if (!userIdResolved) return res.status(400).json({ error: 'User ID is required.' });
    if (!name || !avatar) return res.status(400).json({ error: 'Name and avatar are required.' });
    if (name.length < 2)  return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
    if (name.length > 20) return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (String(profile.userId) != String(userIdResolved)) return res.status(403).json({ error: 'Not authorized to edit this profile.' });

    const dup = await Profile.exists({
      _id: { $ne: profile._id },
      userId: userIdResolved,
      name: new RegExp(`^${sanitizeRegex(name)}$`, 'i')
    });
    if (dup) return res.status(409).json({ error: 'Profile name already exists.' });

    profile.name = name;
    profile.avatar = avatar;
    await profile.save();

    await writeLog({ 
      event: 'profile_update', 
      userId: userIdResolved, 
      profileId: String(profileId),
      details: { profileId: String(profileId), profileName: name, avatar } 
    });

    return res.json({
      id: String(profile._id),
      userId: String(profile.userId),
      name: profile.name,
      avatar: profile.avatar,
      likedContent: profile.likedContent || [],
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt
    });
  } catch (e) {
    console.error('Error updating profile:', e);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.params.id);
    const userIdResolved = req.session?.userId;
    if (!userIdResolved) return res.status(401).json({ error: 'Authentication required.' });

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (String(profile.userId) != String(userIdResolved)) return res.status(403).json({ error: 'Not authorized to delete this profile.' });

    await Like.deleteMany({ profileId: String(profileId) });
    await Profile.deleteOne({ _id: profileId });

    await writeLog({ 
      event: 'profile_delete', 
      userId: userIdResolved, 
      profileId: String(profileId),
      details: { profileId: String(profileId), profileName: profile.name, avatar: profile.avatar } 
    });

    return res.json({ ok: true, message: 'Profile deleted successfully.' });
  } catch (e) {
    console.error('Error deleting profile:', e);
    return res.status(500).json({ error: 'Failed to delete profile.' });
  }
});

// ====== Statistics ======
app.get('/api/stats/daily-views', requireAuth, async (req, res) => {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) {
      return res.status(400).json({ ok: false, error: 'User ID is required.' });
    }

    const daysParam = Number.parseInt(req.query.days, 10);
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 30) : 7;
    const dayMs = 24 * 60 * 60 * 1000;

    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const rangeStart = new Date(todayUtc.getTime() - (days - 1) * dayMs);
    const rangeEndExclusive = new Date(todayUtc.getTime() + dayMs);

    const profiles = await Profile.find({ userId: resolvedUserId }, '_id name').sort({ createdAt: 1 }).lean();

    if (!profiles.length) {
      return res.json({
        profiles: [],
        range: {
          days,
          start: rangeStart.toISOString(),
          end: todayUtc.toISOString(),
        },
      });
    }

    const profileIds = profiles.map((p) => String(p._id));

    const aggregation = await WatchProgress.aggregate([
      {
        $match: {
          profileId: { $in: profileIds },
          completed: true,
          updatedAt: { $gte: rangeStart, $lt: rangeEndExclusive },
        },
      },
      {
        $project: {
          profileId: 1,
        },
      },
      {
        $group: {
          _id: '$profileId',
          views: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          profileId: '$_id',
          views: 1,
        },
      },
    ]);

    const countsByKey = new Map();
    aggregation.forEach((row) => {
      countsByKey.set(String(row.profileId), Number(row.views) || 0);
    });

    const payload = profiles.map((profile) => ({
      profileId: String(profile._id),
      profileName: profile.name,
      views: countsByKey.get(String(profile._id)) || 0,
    }));

    return res.json({
      profiles: payload,
      range: {
        days,
        start: rangeStart.toISOString(),
        end: todayUtc.toISOString(),
      },
    });
  } catch (err) {
    console.error('GET /api/stats/daily-views error:', err);
    await writeLog({
      level: 'error',
      event: 'stats_daily_views',
      details: { error: err.message },
    });
    return res.status(500).json({ error: 'Failed to load daily views statistics.' });
  }
});

app.get('/api/stats/genre-popularity', requireAuth, async (req, res) => {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) {
      return res.status(400).json({ ok: false, error: 'User ID is required.' });
    }

    const limitParam = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 3), 20) : 12;

    const contents = await Content.find({}, 'genres likes').lean();
    const genreTotals = new Map();

    contents.forEach((doc) => {
      const likes = Number(doc.likes) || 0;
      const genres = Array.isArray(doc.genres) && doc.genres.length ? doc.genres : ['Unknown'];
      genres.forEach((rawGenre) => {
        const genre = String(rawGenre || '').trim() || 'Unknown';
        genreTotals.set(genre, (genreTotals.get(genre) || 0) + likes);
      });
    });

    const sorted = Array.from(genreTotals.entries())
      .sort((a, b) => {
        if (b[1] === a[1]) return a[0].localeCompare(b[0]);
        return b[1] - a[1];
      })
      .slice(0, limit);

    const payload = sorted.map(([genre, views]) => ({ genre, views }));
    return res.json(payload);
  } catch (err) {
    console.error('GET /api/stats/genre-popularity error:', err);
    await writeLog({
      level: 'error',
      event: 'stats_genre_popularity',
      details: { error: err.message },
    });
    return res.status(500).json({ error: 'Failed to load genre popularity statistics.' });
  }
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let dest;
    if (file.fieldname === 'imageFile') {
      dest = path.join(__dirname, '..', 'uploads/images');
    } else if (file.fieldname === 'videoFile') {
      dest = path.join(__dirname, '..', 'uploads/videos');
    } else {
      dest = path.join(__dirname, '..', 'uploads/other');
    }
    fs.mkdir(dest, { recursive: true }).then(() => cb(null, dest)).catch(cb);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'imageFile') {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  } else if (file.fieldname === 'videoFile') {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 video files are allowed!'), false);
    }
  } else {
    cb(new Error('Invalid file field!'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

app.post(
  '/api/admin/content', 
  requireAuth, 
  requireAdmin, 
  upload.fields([
    { name: 'imageFile', maxCount: 1 },
    { name: 'videoFile', maxCount: 1 }
  ]), 
  async (req, res) => {
    
    const { extId, title, year, genres, type } = req.body;

    if (!extId || !title || !year || !genres || !type) {
      return res.status(400).json({ ok: false, error: 'All text fields are required (extId, title, year, genres, type).' });
    }
    
    const imageFile = req.files?.imageFile?.[0];
    const videoFile = req.files?.videoFile?.[0];
    
    const existingContent = await Content.findOne({ extId: extId }).lean();
    
    // For new content: require image for all; require video only for Movies
    if (!existingContent) {
      const isMovie = /movie/i.test(String(type || ''));
      if (!imageFile || (isMovie && !videoFile)) {
        return res.status(400).json({ ok: false, error: isMovie
          ? 'Image and Video files are required when creating a Movie.'
          : 'Image file is required when creating a Series.'
        });
      }
    }
    let omdbData = {};
    if (OMDB_API_KEY) {
      try {
        const url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}&y=${year}`;
        const response = await axios.get(url);
        
    if (response.data && response.data.Response === "True") {
      const ratingRaw = Number.parseFloat(response.data.imdbRating);
      const hasRating = Number.isFinite(ratingRaw);
      omdbData = {
        plot: response.data.Plot,
        director: response.data.Director,
        actors: response.data.Actors ? response.data.Actors.split(',').map(s => s.trim()) : [],
        ...(hasRating ? { rating: `${response.data.imdbRating}/10 (IMDb)`, ratingValue: ratingRaw } : {}),
      };
      if (hasRating) {
        console.log(`[OMDb] Fetched rating for ${title}: ${omdbData.rating}`);
      } else {
        console.warn(`[OMDb] Rating missing for ${title}`);
      }
        } else {
          console.warn(`[OMDb] Could not find data for ${title} (${year})`);
        }
      } catch (e) {
        console.error('[OMDb] Error fetching data:', e.message);
      }
    } else {
      console.warn('[OMDb] OMDB_API_KEY is not set. Skipping rating fetch.');
    }
    const doc = {
      extId,
      title,
      year: Number(year),
      genres: Array.isArray(genres) ? genres.filter(Boolean) : String(genres).split(',').map(s => s.trim()).filter(Boolean),
      type,
      ...omdbData 
    };
    
    if (imageFile) {
      const path = `/uploads/images/${imageFile.filename}`;
      doc.imagePath = path;
      doc.cover = path; 
  }
    
    if (videoFile) {
      const isMovie = /movie/i.test(String(type || ''));
      if (isMovie) {
        doc.videoPath = `/uploads/videos/${videoFile.filename}`;
      }
      // For Series, videos should be added via /api/admin/episodes; ignore here to avoid bad data
    }
    try {
      const upsertRes = await Content.updateOne(
        { extId: doc.extId },
        { 
          $set: doc, 
          $setOnInsert: { likes: 0 } 
        },
        { upsert: true } 
      );

      const finalDoc = await Content.findOne({ extId: doc.extId }).lean();
      if (!finalDoc) {
        throw new Error('Content was saved but could not be reloaded');
      }

      try {
        await syncContentJsonWithDoc(finalDoc);
        await seedContentIfNeeded({ force: true });
      } catch (syncErr) {
        console.error('POST /api/admin/content sync error:', syncErr);
        await writeLog({
          level: 'error',
          event: 'content_admin_sync',
          userId: req.session.userId,
          details: { error: syncErr.message, extId: doc.extId },
        });
        return res.status(500).json({
          ok: false,
          error: 'Content saved but failed to sync content.json. Please retry.',
        });
      }

      const logDetails = { contentExtId: finalDoc.extId, title: finalDoc.title };
      
      if (upsertRes.upsertedCount > 0) {
        await writeLog({ event: 'content_create', userId: req.session.userId, details: logDetails });
        return res.status(201).json({ ok: true, data: finalDoc, action: 'created' });
      } else {
        await writeLog({ event: 'content_update', userId: req.session.userId, details: logDetails });
        return res.status(200).json({ ok: true, data: finalDoc, action: 'updated' });
      }

    } catch (err) {
      console.error('POST /api/admin/content error:', err);
      if (err?.code === 11000) {
        return res.status(409).json({ ok:false, error: 'A content item with this External ID already exists.' });
      }
      await writeLog({ level: 'error', event: 'content_admin_op', userId: req.session.userId, details: { error: err.message } });
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

// ====== Admin: Add/Update Episode for Series ======
app.post(
  '/api/admin/episodes',
  requireAuth,
  requireAdmin,
  upload.fields([
    { name: 'videoFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { seriesExtId, season, episode, title } = req.body || {};
      const videoFile = req.files?.videoFile?.[0];
      if (!seriesExtId || !season || !episode || !videoFile) {
        return res.status(400).json({ ok: false, error: 'seriesExtId, season, episode and videoFile are required' });
      }

      const series = await Content.findOne({ extId: String(seriesExtId) });
      if (!series) return res.status(404).json({ ok: false, error: 'Series not found' });
      if (!/series/i.test(series.type || '')) return res.status(400).json({ ok: false, error: 'Target content is not a Series' });

      const durationRaw = Number.parseInt((req.body && (req.body.durationSec ?? req.body.duration)) ?? '0', 10);
      const ep = {
        season: Number(season),
        episode: Number(episode),
        title: String(title || `Episode ${episode}`),
        videoPath: `/uploads/videos/${videoFile.filename}`,
        durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
      };

      // Upsert: remove existing same S/E and push new one
      const filtered = (series.episodes || []).filter(e => !(Number(e.season) === ep.season && Number(e.episode) === ep.episode));
      filtered.push(ep);
      // sort by season then episode
      filtered.sort((a,b)=> (a.season - b.season) || (a.episode - b.episode));
      series.episodes = filtered;
      await series.save();

      const updatedSeries = await Content.findOne({ extId: String(seriesExtId) }).lean();
      if (!updatedSeries) {
        throw new Error('Series saved but could not be reloaded');
      }

      try {
        await syncContentJsonWithDoc(updatedSeries, { overrideEpisodes: updatedSeries.episodes || [] });
        await seedContentIfNeeded({ force: true });
      } catch (syncErr) {
        console.error('POST /api/admin/episodes sync error:', syncErr);
        await writeLog({
          level: 'error',
          event: 'episode_admin_sync',
          userId: req.session.userId,
          details: { error: syncErr.message, seriesExtId },
        });
        return res.status(500).json({
          ok: false,
          error: 'Episode saved but failed to sync content.json. Please retry.',
        });
      }

      await writeLog({ event: 'episode_upsert', userId: req.session.userId, details: { seriesExtId, season: ep.season, episode: ep.episode, title: ep.title } });
      return res.status(201).json({ ok: true, seriesExtId, episode: ep });
    } catch (err) {
      console.error('POST /api/admin/episodes error:', err);
      await writeLog({ level: 'error', event: 'episode_admin_op', userId: req.session.userId, details: { error: err.message } });
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  }
);

// ====== Admin: Repair media paths (cleanup stale DB entries) ======
app.post('/api/admin/repair-media-paths', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await Content.find({}).lean();
    let cleaned = 0, episodePruned = 0, checked = 0;
    const existsLocal = async (p) => {
      try {
        const rel = String(p || '').replace(/^\/+/, '');
        const abs = path.join(__dirname, '..', rel);
        await fs.access(abs);
        return true;
      } catch { return false; }
    };
    for (const it of items) {
      checked++;
      const unset = {};
      const set = {};
      if (it.videoPath && /^\/?uploads\//i.test(String(it.videoPath))) {
        const ok = await existsLocal(it.videoPath);
        if (!ok) { unset.videoPath = ''; cleaned++; }
      }
      if (it.imagePath && /^\/?uploads\//i.test(String(it.imagePath))) {
        const ok = await existsLocal(it.imagePath);
        if (!ok) { unset.imagePath = ''; cleaned++; }
      }
      if (it.cover && /^\/?uploads\//i.test(String(it.cover))) {
        const ok = await existsLocal(it.cover);
        if (!ok) { unset.cover = ''; cleaned++; }
      }
      if (Array.isArray(it.episodes) && it.episodes.length) {
        const checks = await Promise.all(it.episodes.map(e => existsLocal(e.videoPath)));
        const filtered = it.episodes.filter((_, i) => checks[i]);
        if (filtered.length !== it.episodes.length) {
          set.episodes = filtered;
          episodePruned += (it.episodes.length - filtered.length);
        }
      }
      if (Object.keys(unset).length || Object.keys(set).length) {
        const update = {};
        if (Object.keys(unset).length) update.$unset = unset;
        if (Object.keys(set).length) update.$set = set;
        await Content.updateOne({ _id: it._id }, update);
      }
    }
    await writeLog({ event: 'admin_repair_media_paths', details: { checked, cleaned, episodePruned } });
    res.json({ ok: true, checked, cleaned, episodePruned });
  } catch (err) {
    console.error('POST /api/admin/repair-media-paths error:', err);
    await writeLog({ level: 'error', event: 'admin_repair_media_paths', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error during repair' });
  }
});
// ====== Feed ======
app.get('/api/feed', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const sort   = String(req.query.sort || 'popular').toLowerCase();
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);
    const offset = parsePositiveInt(req.query.offset, 0);

    const baseFilter = {};
    let sortSpec;
    switch (sort) {
      case 'alpha':
        sortSpec = { title: 1 };
        break;
      case 'rating':
        sortSpec = { ratingValue: -1, likes: -1, title: 1 };
        baseFilter.ratingValue = { $ne: null };
        break;
      default:
        sortSpec = { likes: -1, title: 1 };
        break;
    }

    const items = await Content.find(baseFilter)
      .sort(sortSpec)
      .skip(offset)
      .limit(limit)
      .lean();

    if (!profileId) {
      await writeLog({ event: 'feed', details: { sort, limit, offset, count: items.length } });
      return res.json({ ok: true, items });
    }

    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({ event: 'feed', profileId, details: { sort, limit, offset, count: annotated.length } });
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
    const offset    = parsePositiveInt(req.query.offset, 0);
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

    let sortSpec;
    switch (sort) {
      case 'alpha':
        sortSpec = { title: 1 };
        break;
      case 'rating':
        sortSpec = { ratingValue: -1, likes: -1, title: 1 };
        filter.ratingValue = { $ne: null };
        break;
      default:
        sortSpec = { likes: -1, title: 1 };
        break;
    }

    let items = await Content.find(filter)
      .sort(sortSpec)
      .skip(offset)
      .limit(limit)
      .lean();

    // Deduplicate by normalized title to avoid multiple entries for the same movie/series title
    const norm = (t) => String(t || '').trim().toLowerCase();
    const pickScore = (i) => {
      const likes = Number(i.likes || 0);
      const rating = Number.isFinite(i.ratingValue) ? Number(i.ratingValue) : 0;
      return likes * 1000 + rating; // prioritize likes, then rating
    };
    const byTitle = new Map();
    for (const it of items) {
      const key = norm(it.title);
      const prev = byTitle.get(key);
      if (!prev) {
        byTitle.set(key, it);
      } else {
        if (pickScore(it) > pickScore(prev)) byTitle.set(key, it);
      }
    }
    items = Array.from(byTitle.values());

    if (!profileId) {
      await writeLog({ event: 'search', details: { q, type, genre, yFrom, yTo, sort, limit, offset, count: items.length } });
      return res.json({ ok: true, query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit, offset }, items });
    }

    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({ event: 'search', profileId, details: { q, type, genre, yFrom, yTo, sort, limit, offset, count: annotated.length } });
    res.json({ ok: true, query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit, offset }, items: annotated });
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
      const updated = await Content.findById(content._id, 'extId likes').lean();
      const likeCount = Math.max(0, Number(updated?.likes || 0));
      if (updated) {
        try { await syncContentJsonWithDoc(updated); } catch (syncErr) { console.warn('like sync error:', syncErr.message); }
      }
      await writeLog({ event: 'like_toggle', profileId, details: { contentExtId, like: true } });
      return res.json({ ok: true, liked: true, likes: likeCount });
    } else {
      const removed = await Like.deleteOne({ profileId, contentExtId });
      if (removed.deletedCount === 1) {
        await Content.updateOne({ _id: content._id }, { $inc: { likes: -1 } });
      }
      const updated = await Content.findById(content._id, 'extId likes').lean();
      const likeCount = Math.max(0, Number(updated?.likes || 0));
      if (updated) {
        try { await syncContentJsonWithDoc(updated); } catch (syncErr) { console.warn('like sync error:', syncErr.message); }
      }
      await writeLog({ event: 'like_toggle', profileId, details: { contentExtId, like: false } });
      return res.json({ ok: true, liked: false, likes: likeCount });
    }
  } catch (err) {
    console.error('POST /api/likes/toggle error:', err);
    await writeLog({ level: 'error', event: 'like_toggle', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Failed to update like' });
  }
});

// ====== Content Details ======
app.get('/api/content/:extId', async (req, res) => {
  try {
    const extId = String(req.params.extId || '').trim();
    const profileId = String(req.query.profileId || '').trim();
    if (!extId) return res.status(400).json({ ok: false, error: 'extId is required' });

    const doc = await Content.findOne({ extId }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Content not found' });

    // Filter out episodes whose files no longer exist
    let episodes = Array.isArray(doc.episodes) ? doc.episodes.slice() : [];
    if (episodes.length) {
      const checks = await Promise.all(episodes.map(async (e) => {
        try {
          const p = String(e.videoPath || '').replace(/^\/+/, '');
          const abs = path.join(__dirname, '..', p);
          await fs.access(abs);
          return true;
        } catch { return false; }
      }));
      episodes = episodes.filter((_, i) => checks[i]);
    }

    // Resolve a reliable cover/image path
    const cover = await resolveCoverForDoc(doc);

    // Ensure videoPath points to an existing file only; no global cross-fallback
    let movieVideo = '';
    let shouldUnsetVideoPath = false;
    if (doc.videoPath) {
      try {
        const rel = String(doc.videoPath).replace(/^\/+/, '');
        const abs = path.join(__dirname, '..', rel);
        await fs.access(abs);
        movieVideo = doc.videoPath; // valid, keep original
      } catch {
        movieVideo = '';
        shouldUnsetVideoPath = true; // clean stale DB value
      }
    }

    // Do not auto-assign arbitrary uploaded videos to movies without a video.
    // A movie's video must be explicitly uploaded and linked via the admin panel.

    // Sanitize image/cover paths that point to missing local files
    const toUnset = {};
    async function existsLocal(p) {
      try {
        const rel = String(p || '').replace(/^\/+/, '');
        const abs = path.join(__dirname, '..', rel);
        await fs.access(abs);
        return true;
      } catch { return false; }
    }
    if (doc.imagePath && /^\/?uploads\//i.test(String(doc.imagePath))) {
      const ok = await existsLocal(doc.imagePath);
      if (!ok) toUnset.imagePath = '';
    }
    if (doc.cover && /^\/?uploads\//i.test(String(doc.cover))) {
      const ok = await existsLocal(doc.cover);
      if (!ok) toUnset.cover = '';
    }
    if (shouldUnsetVideoPath) toUnset.videoPath = '';

    // If any episodes were filtered out, persist the cleaned list to DB to prevent stale entries
    const hadEpisodes = Array.isArray(doc.episodes) ? doc.episodes.length : 0;
    const episodesChanged = hadEpisodes && hadEpisodes !== episodes.length;
    if (Object.keys(toUnset).length || episodesChanged) {
      const update = {};
      if (Object.keys(toUnset).length) update.$unset = toUnset;
      if (episodesChanged) update.$set = { episodes };
      try { await Content.updateOne({ extId }, update); } catch {}
    }

    let liked = false;
    if (profileId) {
      const likeDoc = await Like.findOne({ profileId, contentExtId: extId }).lean();
      liked = !!likeDoc;
    }
    return res.json({ ok: true, item: { ...doc, videoPath: movieVideo, episodes, liked, cover: cover || doc.cover, imagePath: doc.imagePath || cover } });
  } catch (err) {
    console.error('GET /api/content/:extId error:', err);
    await writeLog({ level: 'error', event: 'content_details', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Similar by Genres ======
app.get('/api/similar', async (req, res) => {
  try {
    const extId = String(req.query.extId || '').trim();
    const profileId = String(req.query.profileId || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '12', 10) || 12, 1), 50);
    if (!extId) return res.status(400).json({ ok: false, error: 'extId is required' });

    const base = await Content.findOne({ extId }, 'genres').lean();
    if (!base) return res.status(404).json({ ok: false, error: 'Base content not found' });
    const genres = base.genres || [];
    if (!genres.length) return res.json({ ok: true, items: [] });

    let items = await Content.find({ extId: { $ne: extId }, genres: { $in: genres } })
      .sort({ likes: -1, title: 1 })
      .limit(limit)
      .lean();

    // Ensure valid covers
    items = await Promise.all(items.map(async (i) => {
      const cover = await resolveCoverForDoc(i);
      return { ...i, cover: cover || i.cover, imagePath: i.imagePath || cover };
    }));

    if (!profileId) return res.json({ ok: true, items });

    const liked = await Like.find({ profileId, contentExtId: { $in: items.map(i => i.extId) } }, 'contentExtId').lean();
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ ...i, liked: likedSet.has(i.extId) }));
    res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/similar error:', err);
    await writeLog({ level: 'error', event: 'similar', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Watch Progress ======
app.get('/api/progress', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const contentExtId = String(req.query.contentExtId || '').trim();
    if (!profileId || !contentExtId) return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });

    const docs = await WatchProgress.find({ profileId, contentExtId }).sort({ updatedAt: -1 }).lean();
    const episodeProgress = docs
      .filter(d => d.season != null || d.episode != null)
      .map(d => ({
        season: d.season,
        episode: d.episode,
        positionSec: d.positionSec,
        durationSec: d.durationSec,
        completed: !!d.completed,
        updatedAt: d.updatedAt,
      }));

    let overall = docs.find(d => d.season == null && d.episode == null) || null;
    let overallPercent = 0;
    let lastPositionSec = 0;
    let lastDurationSec = 0;
    let lastEpisodeRef = null;

    if (overall) {
      overallPercent = overall.durationSec ? Math.min(100, Math.floor((overall.positionSec / overall.durationSec) * 100)) : 0;
      lastPositionSec = overall.positionSec || 0;
      lastDurationSec = overall.durationSec || 0;
    }

    if (!overall && episodeProgress.length) {
      const latest = episodeProgress[0];
      lastPositionSec = latest.positionSec || 0;
      lastDurationSec = latest.durationSec || 0;
      lastEpisodeRef = { season: latest.season, episode: latest.episode };
      const percents = episodeProgress.map(e => e.durationSec ? Math.min(100, Math.floor((e.positionSec / e.durationSec) * 100)) : 0);
      overallPercent = percents.length ? Math.max(...percents) : 0;
    }

    res.json({ ok: true, progress: {
      percent: overallPercent,
      lastPositionSec,
      lastDurationSec,
      lastEpisodeRef,
      episodes: episodeProgress,
    }});
  } catch (err) {
    console.error('GET /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_get', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { profileId, contentExtId, season = null, episode = null, positionSec = 0, durationSec = 0, completed = false } = req.body || {};
    if (!profileId || !contentExtId) return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });

    const filter = { profileId: String(profileId), contentExtId: String(contentExtId), season, episode };
    const update = { $set: { positionSec: Number(positionSec)||0, durationSec: Number(durationSec)||0, completed: !!completed } };
    const opts   = { upsert: true, new: true, setDefaultsOnInsert: true };

    await WatchProgress.findOneAndUpdate(filter, update, opts);

    await writeLog({ event: 'progress_set', profileId: String(profileId), details: { contentExtId: String(contentExtId), season, episode, positionSec, durationSec, completed } });
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_set', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Failed to update progress' });
  }
});

app.delete('/api/progress', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const contentExtId = String(req.query.contentExtId || '').trim();
    if (!profileId || !contentExtId) return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });
    const del = await WatchProgress.deleteMany({ profileId, contentExtId });
    await writeLog({ event: 'progress_reset', profileId, details: { contentExtId, deleted: del.deletedCount } });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_reset', details: { error: err.message } });
    res.status(500).json({ ok: false, error: 'Failed to reset progress' });
  }
});

// ====== Recommendations ======
app.get('/api/recommendations', async (req, res) => {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const offset = parsePositiveInt(req.query.offset, 0);
    
    if (!profileId) {
      return res.status(400).json({ ok: false, error: 'profileId is required' });
    }

    const likedDocs = await Like.find({ profileId }, 'contentExtId').lean();
    const likedIds  = likedDocs.map(l => l.contentExtId);
    
    if (likedIds.length === 0) {
      const popular = await Content.find({})
        .sort({ likes: -1, title: 1 })
        .skip(offset)
        .limit(limit)
        .lean();
      const annotated = popular.map(i => ({ ...i, liked: false }));
      await writeLog({ event: 'recommendations', profileId, details: { topGenres: [], out: annotated.length, offset, note: 'no_likes_yet' } });
      return res.json({ ok: true, items: annotated });
    }

    const likedContents = await Content.find({ extId: { $in: likedIds } }, 'genres').lean();

    const freq = new Map();
    for (const c of likedContents) for (const g of c.genres || []) freq.set(g, (freq.get(g) || 0) + 1);
    const topGenres = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([g])=>g);

    const baseFilter = topGenres.length ? { genres: { $in: topGenres } } : {};
    let candidates = await Content.find({ ...baseFilter, extId: { $nin: likedIds } })
      .sort({ likes: -1, title: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
    // ensure covers
    candidates = await Promise.all(candidates.map(async (i) => {
      const cover = await resolveCoverForDoc(i);
      return { ...i, cover: cover || i.cover, imagePath: i.imagePath || cover };
    }));

    const annotated = candidates.map(i => ({ ...i, liked: false }));
    await writeLog({ event: 'recommendations', profileId, details: { topGenres, out: annotated.length, offset } });
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

function unwrapContentJsonRoot(data) {
  if (Array.isArray(data)) {
    return {
      items: data,
      wrap: (items) => items,
    };
  }
  if (data && typeof data === 'object') {
    const preferredKeys = ['items', 'catalog', 'data'];
    for (const key of preferredKeys) {
      if (Array.isArray(data[key])) {
        return {
          items: data[key],
          wrap: (items) => ({ ...data, [key]: items }),
        };
      }
    }
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        return {
          items: data[key],
          wrap: (items) => ({ ...data, [key]: items }),
        };
      }
    }
  }
  throw new Error('content.json must be/contain an array');
}

async function readContentJsonFile() {
  let lastErr = null;
  for (const candidate of CONTENT_JSON_CANDIDATES) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw);
      const { items, wrap } = unwrapContentJsonRoot(parsed);
      if (!Array.isArray(items)) {
        throw new Error('content.json must be/contain an array');
      }
      return { items: items.slice(), wrap, usedPath: candidate };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('content.json not found');
}

async function writeContentJsonFile(targetPath, items, wrap) {
  const payload = wrap(items);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(targetPath, serialized, 'utf8');
}

function normalizeEpisodeRecord(ep) {
  if (!ep) return null;
  const seasonRaw = Number.parseInt(ep.season ?? ep.seasonNumber ?? '', 10);
  const episodeRaw = Number.parseInt(ep.episode ?? ep.episodeNumber ?? '', 10);
  if (!Number.isFinite(seasonRaw) || !Number.isFinite(episodeRaw)) return null;
  const videoPathRaw = ep.videoPath || ep.path || ep.url;
  if (!videoPathRaw) return null;
  const durationRaw = Number.parseInt(ep.durationSec ?? ep.duration ?? '0', 10);
  const normalized = {
    season: seasonRaw,
    episode: episodeRaw,
    title: typeof ep.title === 'string' ? ep.title : '',
    videoPath: String(videoPathRaw),
    durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
  };
  return normalized;
}

function buildJsonEntryFromDoc(doc, prevEntry = {}, { overrideEpisodes } = {}) {
  const next = { ...prevEntry };
  const extId = String(doc.extId || prevEntry.id || '').trim();
  if (!extId) return prevEntry;
  next.id = extId;

  if (doc.title) next.title = doc.title;
  if (doc.year != null) next.year = doc.year;
  if (Array.isArray(doc.genres)) next.genres = doc.genres.slice();
  if (doc.type) next.type = doc.type;

  if (doc.cover) next.cover = doc.cover;
  if (doc.imagePath) next.imagePath = doc.imagePath;
  if (doc.videoPath) next.videoPath = doc.videoPath;

  if (doc.plot) next.plot = doc.plot;
  if (doc.director) next.director = doc.director;
  if (Array.isArray(doc.actors)) next.actors = doc.actors.slice();
  if (doc.rating) next.rating = doc.rating;
  if (doc.ratingValue != null) next.ratingValue = doc.ratingValue;
  if (doc.likes != null) next.likes = doc.likes;

  const episodesSource = overrideEpisodes ?? doc.episodes;
  if (episodesSource !== undefined) {
    if (Array.isArray(episodesSource)) {
      const normalized = episodesSource
        .map(normalizeEpisodeRecord)
        .filter((ep) => ep !== null);
      const isSeries = /series/i.test(String(doc.type ?? prevEntry.type ?? ''));
      if (normalized.length || isSeries) {
        next.episodes = normalized;
      } else {
        delete next.episodes;
      }
    } else if (episodesSource === null) {
      delete next.episodes;
    }
  }

  return next;
}

async function syncContentJsonWithDoc(doc, options = {}) {
  if (!doc?.extId) return;
  const { items, wrap, usedPath } = await readContentJsonFile();
  const targetId = String(doc.extId).trim();
  const idx = items.findIndex((item) => {
    const candidateId = String(item?.id ?? item?.extId ?? '').trim();
    return candidateId === targetId;
  });
  const prev = idx >= 0 ? items[idx] : {};
  const next = buildJsonEntryFromDoc(doc, prev, options);
  if (next.likes == null) next.likes = prev.likes ?? doc.likes ?? 0;
  if (idx >= 0) {
    items[idx] = next;
  } else {
    items.push(next);
  }
  await writeContentJsonFile(usedPath, items, wrap);
}

// ====== Seed from content.json  ======
async function seedContentIfNeeded({ force = false } = {}) {
  if (!force && !SEED_CONTENT) return;
  try {
    const { items: arr, usedPath } = await readContentJsonFile();

    const toDoc = (it) => {
      const title = it.title || it.name || 'Untitled';
      const extId = String(it.id ?? it.extId ?? title).trim();
      const genres = Array.isArray(it.genres) ? it.genres
        : Array.isArray(it.genre) ? it.genre
        : typeof it.genre === 'string'
          ? it.genre.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
      const cover = it.cover || it.poster || it.image || it.img || '';
      const doc = {
        extId,
        title,
        year: Number(it.year ?? it.releaseYear ?? '') || undefined,
        genres,
        likes: Number.isFinite(it.likes) ? Number(it.likes) : 0,
        cover,
        imagePath: cover,
        type: it.type || (it.seasons ? 'Series' : 'Movie'),
      };

      if (it.plot) doc.plot = String(it.plot);
      if (it.director) doc.director = String(it.director);
      if (Array.isArray(it.actors) && it.actors.length) {
        doc.actors = it.actors.map((a) => String(a).trim()).filter(Boolean);
      } else if (typeof it.actors === 'string' && it.actors.trim()) {
        doc.actors = it.actors.split(',').map((a) => a.trim()).filter(Boolean);
      }
      if (it.rating) {
        const ratingStr = String(it.rating);
        doc.rating = ratingStr;
        const match = ratingStr.match(/[0-9]+(?:\.[0-9]+)?/);
        if (match) {
          const ratingNum = Number.parseFloat(match[0]);
          if (Number.isFinite(ratingNum)) doc.ratingValue = ratingNum;
        }
      }
      if (it.videoPath) doc.videoPath = String(it.videoPath);
      if (Array.isArray(it.episodes)) {
        const normalized = it.episodes
          .map(normalizeEpisodeRecord)
          .filter((ep) => ep !== null);
        doc.episodes = normalized;
      }

      return doc;
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
        const baseUpdate = {
          title: doc.title,
          year: doc.year,
          genres: doc.genres,
          imagePath: doc.imagePath,
          cover: doc.cover,
          type: doc.type,
        };
        if ('plot' in doc) baseUpdate.plot = doc.plot;
        if ('director' in doc) baseUpdate.director = doc.director;
        if ('actors' in doc) baseUpdate.actors = doc.actors;
        if ('likes' in doc) baseUpdate.likes = doc.likes;
        if ('rating' in doc) baseUpdate.rating = doc.rating;
        if ('ratingValue' in doc) baseUpdate.ratingValue = doc.ratingValue;
        if ('videoPath' in doc) baseUpdate.videoPath = doc.videoPath;
        if ('episodes' in doc) baseUpdate.episodes = doc.episodes;

        const updRes = await Content.updateOne(
          { extId: doc.extId },
          { $set: baseUpdate }
        );
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
