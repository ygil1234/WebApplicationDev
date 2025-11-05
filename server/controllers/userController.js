const mongoose = require('mongoose');

const Profile = require('../models/Profile');
const WatchProgress = require('../models/WatchProgress');
const Content = require('../models/Video');
const { NODE_ENV, ROW_SCROLL_STEP } = require('../config/config');
const { resolveUserId, writeLog } = require('../utils/helpers');

function health(req, res) {
  res.json({
    ok: true,
    env: NODE_ENV,
    mongo: mongoose.connection.readyState,
    hasSession: Boolean(req.session),
    sessionUser: req.session?.userId || null,
  });
}

function sessionDebug(req, res) {
  res.json({
    hasSession: Boolean(req.session),
    userId: req.session?.userId,
    username: req.session?.username,
    sessionID: req.sessionID,
    cookies: req.headers.cookie,
  });
}

function appConfig(req, res) {
  res.json({
    ok: true,
    scrollStep: ROW_SCROLL_STEP,
  });
}

async function dailyViews(req, res) {
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

    const profiles = await Profile.find({ userId: resolvedUserId }, '_id name')
      .sort({ createdAt: 1 })
      .lean();

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
}

async function genrePopularity(req, res) {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) {
      return res.status(400).json({ ok: false, error: 'User ID is required.' });
    }

    const limitParam = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 3), 30) : 13;

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

    const sorted = Array.from(genreTotals.entries()).sort((a, b) => {
      if (b[1] === a[1]) return a[0].localeCompare(b[0]);
      return b[1] - a[1];
    });

    const top = sorted.slice(0, limit);
    const others = sorted.slice(limit);
    const otherTotal = others.reduce((sum, [, views]) => sum + views, 0);

    const payload = top.map(([genre, views]) => ({ genre, views }));
    if (otherTotal > 0) {
      payload.push({ genre: 'Other', views: otherTotal });
    }

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
}

module.exports = {
  health,
  sessionDebug,
  appConfig,
  dailyViews,
  genrePopularity,
};
