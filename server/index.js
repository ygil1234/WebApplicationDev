const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const sessionLib = require('express-session');
const MongoStore = require('connect-mongo');

const { connectDatabase } = require('./config/database');
const {
  PORT,
  NODE_ENV,
  IS_PROD,
  MONGODB_URI,
  SESSION_SECRET,
  SERVER_DIR,
} = require('./config/config');
const { seedContentIfNeeded } = require('./utils/helpers');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const profileRoutes = require('./routes/profileRoutes');
const videoRoutes = require('./routes/videoRoutes');
const adminRoutes = require('./routes/adminRoutes');

const User = require('./models/User');
const Content = require('./models/Video');
const Like = require('./models/Like');
const Log = require('./models/Log');
const Profile = require('./models/Profile');
const WatchProgress = require('./models/WatchProgress');
require('./models/Session');

const app = express();
const viewsDir = path.join(SERVER_DIR, '..', 'views');
const publicDir = path.join(SERVER_DIR, '..', 'public');

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
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };
  try {
    const store = MongoStore.create({ mongoUrl: MONGODB_URI });
    return sessionLib({ ...baseOptions, store });
  } catch (err) {
    console.warn('[session] Falling back to MemoryStore:', err.message);
    return sessionLib(baseOptions);
  }
}
app.use(buildSessionMiddleware());

app.use(express.static(publicDir));

const uploadsDir = path.join(publicDir, 'uploads');
app.use(
  '/uploads',
  express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
      if (/\.mp4$/i.test(filePath)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Disposition', 'inline');
      }
    },
  })
);

connectDatabase(MONGODB_URI);

mongoose.connection.once('open', () => {
  seedContentIfNeeded().catch((err) => {
    console.warn('[seed] init error:', err.message);
  });
});

User.init().catch((e) => console.warn('[mongo] User.init index warn:', e.message));
Content.init().catch((e) => console.warn('[mongo] Content.init index warn:', e.message));
Like.init().catch((e) => console.warn('[mongo] Like.init index warn:', e.message));
Profile.init().catch((e) => console.warn('[mongo] Profile.init index warn:', e.message));
WatchProgress.init().catch((e) => console.warn('[mongo] WatchProgress.init index warn:', e.message));
Log.init().catch((e) => console.warn('[mongo] Log.init index warn:', e.message));

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', profileRoutes);
app.use('/api', videoRoutes);
app.use('/api', adminRoutes);

function sendStaticHtml(res, relativePath) {
  res.sendFile(path.join(viewsDir, relativePath));
}

function isAdminSession(req) {
  return req.session?.username === 'admin';
}

function redirectAdminToFeed(req, res, next) {
  if (isAdminSession(req)) {
    return res.redirect('/feed.html');
  }
  return next();
}

function requireAdminPage(req, res, next) {
  if (isAdminSession(req)) {
    return next();
  }
  return res.redirect('/login.html');
}

app.get('/', (_req, res) => sendStaticHtml(res, path.join('user', 'feed.html')));
app.get('/feed.html', (_req, res) => sendStaticHtml(res, path.join('user', 'feed.html')));
app.get('/login.html', redirectAdminToFeed, (_req, res) => sendStaticHtml(res, path.join('auth', 'login.html')));
app.get('/signup.html', redirectAdminToFeed, (_req, res) => sendStaticHtml(res, path.join('auth', 'signup.html')));
app.get('/profiles.html', redirectAdminToFeed, (_req, res) => sendStaticHtml(res, path.join('user', 'profiles.html')));
app.get('/settings.html', redirectAdminToFeed, (_req, res) => sendStaticHtml(res, path.join('user', 'settings.html')));
app.get('/title.html', (_req, res) => sendStaticHtml(res, path.join('user', 'title.html')));
app.get('/admin.html', requireAdminPage, (_req, res) => sendStaticHtml(res, path.join('admin', 'admin.html')));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [${NODE_ENV}]`);
});
