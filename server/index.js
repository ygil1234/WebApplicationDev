// server/index.js - COMPLETE FIXED VERSION
// Matala 4 – Feed backend over MongoDB (Mongoose)

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express    = require('express');
const fs         = require('fs/promises');
const cors       = require('cors');
const mongoose   = require('mongoose');
const session    = require('express-session');
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

// ====== Sessions backed by MongoDB ======
if (IS_PROD) app.set('trust proxy', 1);
app.use(
  session({
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
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  })
);

// ====== DB Connection ======
mongoose.set('strictQuery', true);
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('[mongo] connected'))
  .catch((err) => {
    console.error('[mongo] connection error:', err.message);
    process.exit(1);
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
    event:     { type: String, required: true }, // 'feed'|'search'|'like_toggle'|'recommendations'|'logout'
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
    sessionUser: req.session?.userId || null 
  });
});

// ====== Helpers ======
function sanitizeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeLog({ level = 'info', event, userId = null, profileId = null, details = {} }) {
  try { 
    await Log.create({ level, event, userId, profileId, details }); 
  } catch (e) { 
    console.warn('[log] skip:', e.message); 
  }
}

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

    // Add liked field for authenticated profile
    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ 
      ...i, 
      liked: likedSet.has(i.extId) 
    }));

    await writeLog({ 
      event: 'feed', 
      profileId, 
      details: { sort, limit, count: annotated.length } 
    });
    
    res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/feed error:', err);
    await writeLog({ 
      level: 'error', 
      event: 'feed', 
      details: { error: err.message } 
    });
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
      await writeLog({ 
        event: 'search', 
        details: { q, type, genre, yFrom, yTo, sort, limit, count: items.length } 
      });
      return res.json({ 
        ok: true, 
        query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit }, 
        items 
      });
    }

    // Add liked field for authenticated profile
    const liked = await Like.find({ 
      profileId, 
      contentExtId: { $in: items.map(i => i.extId) } 
    }, 'contentExtId').lean();
    
    const likedSet = new Set(liked.map(l => l.contentExtId));
    const annotated = items.map(i => ({ 
      ...i, 
      liked: likedSet.has(i.extId) 
    }));

    await writeLog({ 
      event: 'search', 
      profileId, 
      details: { q, type, genre, yFrom, yTo, sort, limit, count: annotated.length } 
    });
    
    res.json({ 
      ok: true, 
      query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit }, 
      items: annotated 
    });
  } catch (err) {
    console.error('GET /api/search error:', err);
    await writeLog({ 
      level: 'error', 
      event: 'search', 
      details: { error: err.message } 
    });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Likes ======
app.post('/api/likes/toggle', async (req, res) => {
  try {
    const { profileId, contentExtId, like } = req.body || {};
    
    if (!profileId || !contentExtId || typeof like !== 'boolean') {
      return res.status(400).json({ 
        ok: false, 
        error: 'profileId, contentExtId and like are required' 
      });
    }

    const content = await Content.findOne({ extId: contentExtId });
    if (!content) {
      return res.status(404).json({ ok: false, error: 'Content not found' });
    }

    if (like) {
      // Add like
      const created = await Like.updateOne(
        { profileId, contentExtId },
        { $setOnInsert: { profileId, contentExtId } },
        { upsert: true }
      );
      
      if (created.upsertedCount === 1) {
        await Content.updateOne({ _id: content._id }, { $inc: { likes: 1 } });
      }
      
      const updated = await Content.findById(content._id, 'likes').lean();
      await writeLog({ 
        event: 'like_toggle', 
        profileId, 
        details: { contentExtId, like: true } 
      });
      
      return res.json({ ok: true, liked: true, likes: updated.likes });
    } else {
      // Remove like
      const removed = await Like.deleteOne({ profileId, contentExtId });
      
      if (removed.deletedCount === 1) {
        await Content.updateOne({ _id: content._id }, { $inc: { likes: -1 } });
      }
      
      const updated = await Content.findById(content._id, 'likes').lean();
      await writeLog({ 
        event: 'like_toggle', 
        profileId, 
        details: { contentExtId, like: false } 
      });
      
      return res.json({ ok: true, liked: false, likes: Math.max(0, updated.likes) });
    }
  } catch (err) {
    console.error('POST /api/likes/toggle error:', err);
    await writeLog({ 
      level: 'error', 
      event: 'like_toggle', 
      details: { error: err.message } 
    });
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

    // Get liked content for this profile
    const likedDocs = await Like.find({ profileId }, 'contentExtId').lean();
    const likedIds  = likedDocs.map(l => l.contentExtId);
    
    if (likedIds.length === 0) {
      // No likes yet, return popular content
      const popular = await Content.find({})
        .sort({ likes: -1, title: 1 })
        .limit(limit)
        .lean();
      
      const annotated = popular.map(i => ({ ...i, liked: false }));
      await writeLog({ 
        event: 'recommendations', 
        profileId, 
        details: { topGenres: [], out: annotated.length, note: 'no_likes_yet' } 
      });
      
      return res.json({ ok: true, items: annotated });
    }

    // Get content details for liked items
    const likedContents = await Content.find({ 
      extId: { $in: likedIds } 
    }, 'genres').lean();

    // Count genre frequency
    const freq = new Map();
    for (const c of likedContents) {
      for (const g of c.genres || []) {
        freq.set(g, (freq.get(g) || 0) + 1);
      }
    }
    
    const topGenres = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([g]) => g);

    // Find recommendations based on top genres, excluding already liked
    const baseFilter = topGenres.length 
      ? { genres: { $in: topGenres } } 
      : {};
      
    const candidates = await Content.find({ 
      ...baseFilter, 
      extId: { $nin: likedIds } 
    })
      .sort({ likes: -1, title: 1 })
      .limit(limit)
      .lean();

    const annotated = candidates.map(i => ({ ...i, liked: false }));
    
    await writeLog({ 
      event: 'recommendations', 
      profileId, 
      details: { topGenres, out: annotated.length } 
    });
    
    res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/recommendations error:', err);
    await writeLog({ 
      level: 'error', 
      event: 'recommendations', 
      details: { error: err.message } 
    });
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ====== Logout ======
app.post('/api/logout', async (req, res) => {
  await writeLog({ event: 'logout', details: {} });
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

// ====== Seed from content.json  ======
async function seedContentIfNeeded() {
  if (!SEED_CONTENT) return;
  
  try {
    const candidates = [
      path.resolve(__dirname, 'content.json'),            // server/content.json
      path.resolve(process.cwd(), 'server/content.json'), // fallback
      path.resolve(process.cwd(), 'content.json'),        // project root fallback
    ];

    let raw = null, usedPath = null;
    for (const p of candidates) {
      try { 
        raw = await fs.readFile(p, 'utf-8'); 
        usedPath = p; 
        break; 
      } catch {}
    }
    
    if (!raw) {
      throw new Error('content.json not found in server/ or project root');
    }

    const data = JSON.parse(raw);
    let arr =
      Array.isArray(data) ? data :
      (data && typeof data === 'object' && Array.isArray(data.items))   ? data.items   :
      (data && typeof data === 'object' && Array.isArray(data.catalog)) ? data.catalog :
      (data && typeof data === 'object' && Array.isArray(data.data))    ? data.data    :
      (data && typeof data === 'object' ? Object.values(data).find(Array.isArray) : null);

    if (!Array.isArray(arr)) {
      throw new Error('content.json must be/contain an array');
    }

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
      if (!doc.extId || !doc.title) { 
        skipped++; 
        continue; 
      }

      // Phase 1: upsert new – only $setOnInsert (to avoid conflicts with $set)
      const upsertRes = await Content.updateOne(
        { extId: doc.extId },
        { $setOnInsert: doc },
        { upsert: true }
      );

      if (upsertRes.upsertedCount === 1) {
        inserted++;
      } else {
        // Phase 2: update main fields – $set only (without likes, to not overwrite existing likes)
        const updRes = await Content.updateOne(
          { extId: doc.extId },
          { 
            $set: { 
              title: doc.title, 
              year: doc.year, 
              genres: doc.genres, 
              cover: doc.cover, 
              type: doc.type 
            } 
          }
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

mongoose.connection.once('open', () => {
  seedContentIfNeeded();
});

app.post('/api/admin/seed', async (req, res) => {
  try {
    if ((req.body?.secret || '') !== SESSION_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    await seedContentIfNeeded();
    const count = await Content.countDocuments();
    res.json({ ok: true, count });
  } catch (e) {
    console.error('POST /api/admin/seed error:', e);
    res.status(500).json({ ok: false, error: 'seed failed' });
  }
});

// ====== Root ======
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'feed.html'));
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [${NODE_ENV}]`);
});