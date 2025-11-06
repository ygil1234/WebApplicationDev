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

function sendStaticHtml(res, relativePath, statusCode) {
  const target = path.join(viewsDir, relativePath); // Resolve the requested view relative to the views directory.
  if (typeof statusCode === 'number') {
    return res.status(statusCode).sendFile(target); // Serve the file with an explicit status when provided (e.g., 404 page).
  }
  return res.sendFile(target); // Default to standard static file serving.
}

function isAdminSession(req) {
  return req.session?.username === 'admin'; // Treat session records with the admin username as admin sessions.
}

function redirectAdminTo404(req, res, next) {
  if (isAdminSession(req)) {
    return res.redirect('/404.html'); // Force admins away from user-facing pages.
  }
  return next();
}

function requireAdminPage(req, res, next) {
  if (isAdminSession(req)) {
    return next(); // Allow access when the session truly belongs to the admin.
  }
  if (req.session?.userId) {
    return res.redirect('/404.html'); // Redirect authenticated non-admins trying to reach admin-only content.
  }
  return res.redirect('/login.html'); // Send unauthenticated visitors to the login screen.
}

app.get('/', (req, res) => {
  if (isAdminSession(req)) return res.redirect('/404.html'); // Block the admin session from loading the user feed via root.
  return sendStaticHtml(res, path.join('user', 'feed.html')); // Serve the main feed for non-admin visitors.
});
app.get('/feed.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('user', 'feed.html'))); // Protect the main feed from admin sessions.
app.get('/login.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('auth', 'login.html'))); // Prevent admins from hitting the login form.
app.get('/signup.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('auth', 'signup.html'))); // Prevent admins from hitting the signup form.
app.get('/profiles.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('user', 'profiles.html'))); // Block admin visits to profile selection.
app.get('/settings.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('user', 'settings.html'))); // Block admin visits to settings.
app.get('/title.html', redirectAdminTo404, (_req, res) => sendStaticHtml(res, path.join('user', 'title.html'))); // Block admin visits to individual title pages.
app.get('/admin.html', requireAdminPage, (_req, res) => sendStaticHtml(res, path.join('admin', 'admin.html'))); // Serve the admin dashboard only to the admin session.
app.get('/404.html', (_req, res) => sendStaticHtml(res, path.join('errors', '404.html'), 404)); // Serve the custom 404 page with a 404 status.

app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Not found' }); // Return JSON for missing API endpoints.
  }
  if (req.accepts('html')) {
    return res.redirect('/404.html'); // For browser-facing requests, route to the HTML 404 page.
  }
  return res.status(404).send('Not found'); // Fall back to plain text when HTML is not acceptable.
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} [${NODE_ENV}]`);
});
