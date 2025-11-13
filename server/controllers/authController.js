const User = require('../models/User');
const { writeLog, sanitizeRegex } = require('../utils/helpers');
const { validEmail, validUsername, validPassword } = require('../middlewares/validation');
const {ADMIN_USER, ADMIN_PASSWORD} = require("../config/config");

async function signup(req, res) {
  try {
    const email = String(req.body?.email || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!validEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email.' });
    }
    if (!validUsername(username)) {
      return res
        .status(400)
        .json({
          ok: false,
          error: 'Username must be 3-15 characters (letters/numbers/underscores).',
        });
    }
    if (username.toLowerCase() === 'admin') {
      await writeLog({
        level: 'warn',
        event: 'signup',
        details: { usernameAttempt: username, reason: 'admin_signup_attack' },
      });
      return res
        .status(400)
        .json({ ok: false, error: 'This username admin is reserved.' });
    }
    if (!validPassword(password, username)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Password must be at least 6 characters (unless admin/admin).' });
    }

    const emailExists = await User.exists({
      email: new RegExp(`^${sanitizeRegex(email)}$`, 'i'),
    });
    if (emailExists) {
      writeLog({ level: 'error', event: 'signup_attempt', details: { email, reason: 'email exists' } });
      return res.status(409).json({ ok: false, error: 'Email already registered.' });
    }

    const usernameExists = await User.exists({
      username: new RegExp(`^${sanitizeRegex(username)}$`, 'i'),
    });
    if (usernameExists) {
      writeLog({ level: 'error', event: 'signup_attempt', details: { username, reason: 'username exists' } });
      return res.status(409).json({ ok: false, error: 'Username already taken.' });
    }

    const user = new User({ email, username, password });
    await user.save();

    req.session.userId = String(user._id);
    req.session.username = user.username;

    await writeLog({ event: 'signup', userId: String(user._id), details: { email } });

    return res.status(201).json({
      ok: true,
      user: { id: String(user._id), email: user.email, username: user.username },
    });
  } catch (err) {
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res
        .status(409)
        .json({ ok: false, error: `${field.charAt(0).toUpperCase() + field.slice(1)} already in use.` });
    }
    console.error('POST /api/signup error:', err);
    await writeLog({ level: 'error', event: 'signup', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function adminLogin(req, res) {
  try {
    const usernameInput = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (usernameInput === ADMIN_USER && password === ADMIN_PASSWORD) {
      req.session.userId = 'admin-user-id';
      req.session.username = 'admin';

      await writeLog({ event: 'admin_login', success: true, details: { username: usernameInput } });

      return res.json({
        ok: true,
        user: { id: 'admin-user-id', email: 'admin', username: 'admin' },
      });
    }

    await writeLog({
      event: 'admin_login',
      success: false,
      details: { username: usernameInput, reason: 'invalid credentials' },
    });
    return res.status(401).json({ ok: false, error: 'Invalid admin credentials.' });
  } catch (err) {
    console.error('POST /api/admin-login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function login(req, res) {
  try {
    const usernameInput = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!usernameInput) {
      return res.status(400).json({ ok: false, error: 'Username is required.' });
    }

    const user = await User.findOne({
      username: new RegExp(`^${sanitizeRegex(usernameInput)}$`, 'i'),
    });

    if (!user) {
      await writeLog({
        event: 'login',
        success: false,
        details: { username: usernameInput, reason: 'Username not found.' },
      });
      return res.status(401).json({ ok: false, error: 'Username not found.' });
    }

    const passwordOk = await user.comparePassword(password);
    if (!passwordOk) {
      await writeLog({
        event: 'login',
        success: false,
        userId: String(user._id),
        details: { username: usernameInput, reason: 'bad password' },
      });
      return res.status(401).json({ ok: false, error: 'Incorrect password.' });
    }

    req.session.userId = String(user._id);
    req.session.username = user.username;

    await writeLog({
      event: 'login',
      success: true,
      userId: String(user._id),
      details: { username: usernameInput },
    });

    return res.json({
      ok: true,
      user: { id: String(user._id), email: user.email, username: user.username },
    });
  } catch (err) {
    console.error('POST /api/login error:', err);
    await writeLog({ event: 'login', success: false, details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function logout(req, res) {
  const userId = req.session?.userId ? String(req.session.userId) : null;
  const username = req.session?.username || null;
  await writeLog({
    event: 'logout',
    userId,
    details: { username },
  });
  req.session?.destroy(() => {
    res.clearCookie('sid');
    res.json({ ok: true });
  });
}

module.exports = {
  signup,
  adminLogin,
  login,
  logout,
};
