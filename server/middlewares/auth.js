const User = require('../models/User');
const { writeLog } = require('../utils/helpers');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }
  return next();
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
      details: { username: user?.username || 'unknown' },
    });
    return res.status(403).json({ ok: false, error: 'Forbidden: Admin access required.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Server error during auth check.' });
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
};
