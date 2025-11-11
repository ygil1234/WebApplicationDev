const path = require('path');
const fs = require('fs/promises');

const Content = require('../models/Video');
const Like = require('../models/Like');
const WatchProgress = require('../models/WatchProgress');
const { SERVER_DIR } = require('../config/config');
const {
  parsePositiveInt,
  sanitizeRegex,
  writeLog,
  resolveCoverForDoc,
} = require('../utils/helpers');

async function annotateWatchedTags(items, profileId) {
  if (!profileId) return;
  const ids = items
    .map((item) => (item && typeof item.extId === 'string' ? item.extId : null))
    .filter(Boolean);
  if (!ids.length) return;

  const uniqueIds = [...new Set(ids)];
  const stats = await WatchProgress.aggregate([
    {
      $match: {
        profileId,
        contentExtId: { $in: uniqueIds },
        completed: true,
      },
    },
    {
      $group: {
        _id: '$contentExtId',
        episodesCompleted: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$season', null] },
                  { $ne: ['$episode', null] },
                ],
              },
              1,
              0,
            ],
          },
        },
        overallCompleted: {
          $max: {
            $cond: [
              {
                $and: [
                  { $eq: ['$season', null] },
                  { $eq: ['$episode', null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const statsById = new Map(stats.map((row) => [row._id, row]));
  items.forEach((item) => {
    if (!item || !item.extId) return;
    const stat = statsById.get(item.extId);
    if (!stat) return;
    const episodesCount = Array.isArray(item.episodes) ? item.episodes.length : 0;
    const watched = episodesCount > 0
      ? stat.episodesCompleted >= episodesCount
      : stat.overallCompleted > 0;
    if (!watched) return;
    if (Array.isArray(item.tags)) {
      if (!item.tags.includes('watched')) item.tags.push('watched');
    } else {
      item.tags = ['watched'];
    }
  });
}

async function getFeed(req, res) {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const sort = String(req.query.sort || 'popular').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);
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
      case 'newest':
        sortSpec = { year: -1, createdAt: -1, title: 1 };
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

    await annotateWatchedTags(items, profileId);
    const liked = await Like.find(
      {
        profileId,
        contentExtId: { $in: items.map((i) => i.extId) },
      },
      'contentExtId'
    ).lean();

    const likedSet = new Set(liked.map((l) => l.contentExtId));
    const annotated = items.map((i) => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({
      event: 'feed',
      profileId,
      details: { sort, limit, offset, count: annotated.length },
    });
    return res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/feed error:', err);
    await writeLog({ level: 'error', event: 'feed', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function searchContent(req, res) {
  try {
    const q = String(req.query.query || '').trim();
    const type = String(req.query.type || '').trim().toLowerCase();
    const genre = String(req.query.genre || '').trim().toLowerCase();
    const yFromStr = String(req.query.year_from || '').trim();
    const yToStr = String(req.query.year_to || '').trim();
    const sort = String(req.query.sort || 'popular').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 200);
    const offset = parsePositiveInt(req.query.offset, 0);
    const profileId = String(req.query.profileId || '').trim();

    const yFrom = yFromStr ? Number(yFromStr) : null;
    const yTo = yToStr ? Number(yToStr) : null;
    if ((yFromStr && Number.isNaN(yFrom)) || (yToStr && Number.isNaN(yTo))) {
      return res.status(400).json({ ok: false, error: 'Invalid year range' });
    }
    if (yFrom && yTo && yFrom > yTo) {
      return res.status(400).json({ ok: false, error: 'year_from must be <= year_to' });
    }

    const filter = {};
    if (q) filter.title = { $regex: sanitizeRegex(q), $options: 'i' };
    if (type) filter.type = new RegExp(`^${sanitizeRegex(type)}$`, 'i');
    if (genre) filter.genres = { $elemMatch: { $regex: new RegExp(sanitizeRegex(genre), 'i') } };
    if (yFrom != null || yTo != null) {
      filter.year = {};
      if (yFrom != null) filter.year.$gte = yFrom;
      if (yTo != null) filter.year.$lte = yTo;
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
      case 'newest':
        sortSpec = { year: -1, createdAt: -1, title: 1 };
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

    const norm = (t) => String(t || '').trim().toLowerCase();
    const pickScore = (i) => {
      const likes = Number(i.likes || 0);
      const rating = Number.isFinite(i.ratingValue) ? Number(i.ratingValue) : 0;
      return likes * 1000 + rating;
    };
    const byTitle = new Map();
    for (const it of items) {
      const key = norm(it.title);
      const prev = byTitle.get(key);
      if (!prev || pickScore(it) > pickScore(prev)) {
        byTitle.set(key, it);
      }
    }
    items = Array.from(byTitle.values());

    if (!profileId) {
      await writeLog({
        event: 'search',
        details: { q, type, genre, yFrom, yTo, sort, limit, offset, count: items.length },
      });
      return res.json({
        ok: true,
        query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit, offset },
        items,
      });
    }

    await annotateWatchedTags(items, profileId);
    const liked = await Like.find(
      {
        profileId,
        contentExtId: { $in: items.map((i) => i.extId) },
      },
      'contentExtId'
    ).lean();

    const likedSet = new Set(liked.map((l) => l.contentExtId));
    const annotated = items.map((i) => ({ ...i, liked: likedSet.has(i.extId) }));

    await writeLog({
      event: 'search',
      profileId,
      details: { q, type, genre, yFrom, yTo, sort, limit, offset, count: annotated.length },
    });
    return res.json({
      ok: true,
      query: { q, type, genre, year_from: yFrom, year_to: yTo, sort, limit, offset },
      items: annotated,
    });
  } catch (err) {
    console.error('GET /api/search error:', err);
    await writeLog({ level: 'error', event: 'search', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function toggleLike(req, res) {
  try {
    const { profileId, contentExtId, like } = req.body || {};

    if (!profileId || !contentExtId || typeof like !== 'boolean') {
      return res
        .status(400)
        .json({ ok: false, error: 'profileId, contentExtId and like are required' });
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
    }

    const removed = await Like.deleteOne({ profileId, contentExtId });
    if (removed.deletedCount === 1) {
      await Content.updateOne({ _id: content._id }, { $inc: { likes: -1 } });
    }
    const updated = await Content.findById(content._id, 'likes').lean();
    await writeLog({ event: 'like_toggle', profileId, details: { contentExtId, like: false } });
    return res.json({ ok: true, liked: false, likes: Math.max(0, updated.likes) });
  } catch (err) {
    console.error('POST /api/likes/toggle error:', err);
    await writeLog({ level: 'error', event: 'like_toggle', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Failed to update like' });
  }
}

async function getContentDetails(req, res) {
  try {
    const extId = String(req.params.extId || '').trim();
    const profileId = String(req.query.profileId || '').trim();
    if (!extId) return res.status(400).json({ ok: false, error: 'extId is required' });

    const doc = await Content.findOne({ extId }).lean();
    if (!doc) return res.status(404).json({ ok: false, error: 'Content not found' });

    let episodes = Array.isArray(doc.episodes) ? doc.episodes.slice() : [];
    if (episodes.length) {
      const checks = await Promise.all(
        episodes.map(async (episode) => {
          try {
            const p = String(episode.videoPath || '').replace(/^\/+/g, '');
            const fsRel = p.replace(/^IMG\//i, 'img/');
            const abs = path.join(SERVER_DIR, '..', 'public', fsRel);
            await fs.access(abs);
            return true;
          } catch {
            return false;
          }
        })
      );
      episodes = episodes.filter((_, index) => checks[index]);
    }

    const cover = await resolveCoverForDoc(doc);

    let movieVideo = '';
    let shouldUnsetVideoPath = false;
    if (doc.videoPath) {
      try {
        const rel = String(doc.videoPath).replace(/^\/+/g, '');
        const fsRel = rel.replace(/^IMG\//i, 'img/');
        const abs = path.join(SERVER_DIR, '..', 'public', fsRel);
        await fs.access(abs);
        movieVideo = doc.videoPath;
      } catch {
        movieVideo = '';
        shouldUnsetVideoPath = true;
      }
    }

    const toUnset = {};
    async function existsLocal(candidatePath) {
      try {
        const rel = String(candidatePath || '').replace(/^\/+/g, '');
        const fsRel = rel.replace(/^IMG\//i, 'img/');
        const abs = path.join(SERVER_DIR, '..', 'public', fsRel);
        await fs.access(abs);
        return true;
      } catch {
        return false;
      }
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

    const hadEpisodes = Array.isArray(doc.episodes) ? doc.episodes.length : 0;
    const episodesChanged = hadEpisodes && hadEpisodes !== episodes.length;
    if (Object.keys(toUnset).length || episodesChanged) {
      const update = {};
      if (Object.keys(toUnset).length) update.$unset = toUnset;
      if (episodesChanged) update.$set = { episodes };
      try {
        await Content.updateOne({ extId }, update);
      } catch (cleanupErr) {
        console.warn('[content_details] cleanup skipped:', cleanupErr.message);
      }
    }

    let liked = false;
    if (profileId) {
      const likeDoc = await Like.findOne({ profileId, contentExtId: extId }).lean();
      liked = !!likeDoc;
    }
    const item = {
      ...doc,
      videoPath: movieVideo,
      episodes,
      liked,
      cover: cover || doc.cover,
      imagePath: doc.imagePath || cover,
    };
    await annotateWatchedTags([item], profileId);
    return res.json({ ok: true, item });
  } catch (err) {
    console.error('GET /api/content/:extId error:', err);
    await writeLog({ level: 'error', event: 'content_details', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function getSimilar(req, res) {
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

    items = await Promise.all(
      items.map(async (item) => {
        const cover = await resolveCoverForDoc(item);
        return { ...item, cover: cover || item.cover, imagePath: item.imagePath || cover };
      })
    );

    if (!profileId) return res.json({ ok: true, items });

    await annotateWatchedTags(items, profileId);
    const liked = await Like.find(
      { profileId, contentExtId: { $in: items.map((i) => i.extId) } },
      'contentExtId'
    ).lean();
    const likedSet = new Set(liked.map((l) => l.contentExtId));
    const annotated = items.map((item) => ({ ...item, liked: likedSet.has(item.extId) }));
    return res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/similar error:', err);
    await writeLog({ level: 'error', event: 'similar', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function getProgress(req, res) {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const contentExtId = String(req.query.contentExtId || '').trim();
    if (!profileId || !contentExtId) {
      return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });
    }

    const docs = await WatchProgress.find({ profileId, contentExtId })
      .sort({ updatedAt: -1 })
      .lean();
    const episodeProgress = docs
      .filter((d) => d.season != null || d.episode != null)
      .map((d) => ({
        season: d.season,
        episode: d.episode,
        positionSec: d.positionSec,
        durationSec: d.durationSec,
        completed: !!d.completed,
        updatedAt: d.updatedAt,
      }));

    let overall = docs.find((d) => d.season == null && d.episode == null) || null;
    let overallPercent = 0;
    let lastPositionSec = 0;
    let lastDurationSec = 0;
    let lastEpisodeRef = null;

    if (overall) {
      overallPercent = overall.durationSec
        ? Math.min(100, Math.floor((overall.positionSec / overall.durationSec) * 100))
        : 0;
      lastPositionSec = overall.positionSec || 0;
      lastDurationSec = overall.durationSec || 0;
    }

    if (!overall && episodeProgress.length) {
      const latest = episodeProgress[0];
      lastPositionSec = latest.positionSec || 0;
      lastDurationSec = latest.durationSec || 0;
      lastEpisodeRef = { season: latest.season, episode: latest.episode };
      const percents = episodeProgress.map((entry) =>
        entry.durationSec
          ? Math.min(100, Math.floor((entry.positionSec / entry.durationSec) * 100))
          : 0
      );
      overallPercent = percents.length ? Math.max(...percents) : 0;
    }

    return res.json({
      ok: true,
      progress: {
        percent: overallPercent,
        lastPositionSec,
        lastDurationSec,
        lastEpisodeRef,
        episodes: episodeProgress,
      },
    });
  } catch (err) {
    console.error('GET /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_get', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function setProgress(req, res) {
  try {
    const {
      profileId,
      contentExtId,
      season = null,
      episode = null,
      positionSec = 0,
      durationSec = 0,
      completed = false,
    } = req.body || {};
    if (!profileId || !contentExtId) {
      return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });
    }

    const filter = {
      profileId: String(profileId),
      contentExtId: String(contentExtId),
      season,
      episode,
    };
    const update = {
      $set: {
        positionSec: Number(positionSec) || 0,
        durationSec: Number(durationSec) || 0,
        completed: !!completed,
      },
    };
    const opts = { upsert: true, new: true, setDefaultsOnInsert: true };

    await WatchProgress.findOneAndUpdate(filter, update, opts);

    await writeLog({
      event: 'progress_set',
      profileId: String(profileId),
      details: { contentExtId: String(contentExtId), season, episode, positionSec, durationSec, completed },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_set', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Failed to update progress' });
  }
}

async function deleteProgress(req, res) {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const contentExtId = String(req.query.contentExtId || '').trim();
    if (!profileId || !contentExtId) {
      return res.status(400).json({ ok: false, error: 'profileId and contentExtId are required' });
    }
    const del = await WatchProgress.deleteMany({ profileId, contentExtId });
    await writeLog({
      event: 'progress_reset',
      profileId,
      details: { contentExtId, deleted: del.deletedCount },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/progress error:', err);
    await writeLog({ level: 'error', event: 'progress_reset', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Failed to reset progress' });
  }
}

async function getRecommendations(req, res) {
  try {
    const profileId = String(req.query.profileId || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 100);
    const offset = parsePositiveInt(req.query.offset, 0);

    if (!profileId) {
      return res.status(400).json({ ok: false, error: 'profileId is required' });
    }

    const likedDocs = await Like.find({ profileId }, 'contentExtId').lean();
    const likedIds = likedDocs.map((l) => l.contentExtId);

    if (likedIds.length === 0) {
      const popular = await Content.find({})
        .sort({ likes: -1, title: 1 })
        .skip(offset)
        .limit(limit)
        .lean();
      await annotateWatchedTags(popular, profileId);
      const annotated = popular.map((item) => ({ ...item, liked: false }));
      await writeLog({
        event: 'recommendations',
        profileId,
        details: { topGenres: [], out: annotated.length, offset, note: 'no_likes_yet' },
      });
      return res.json({ ok: true, items: annotated });
    }

    const likedContents = await Content.find({ extId: { $in: likedIds } }, 'genres').lean();

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

    let candidates = await Content.find({
      ...(topGenres.length ? { genres: { $in: topGenres } } : {}),
      extId: { $nin: likedIds },
    })
      .sort({ likes: -1, title: 1 })
      .skip(offset)
      .limit(limit)
      .lean();
    candidates = await Promise.all(
      candidates.map(async (item) => {
        const cover = await resolveCoverForDoc(item);
        return { ...item, cover: cover || item.cover, imagePath: item.imagePath || cover };
      })
    );

    await annotateWatchedTags(candidates, profileId);
    const annotated = candidates.map((item) => ({ ...item, liked: false }));
    await writeLog({
      event: 'recommendations',
      profileId,
      details: { topGenres, out: annotated.length, offset },
    });
    return res.json({ ok: true, items: annotated });
  } catch (err) {
    console.error('GET /api/recommendations error:', err);
    await writeLog({ level: 'error', event: 'recommendations', details: { error: err.message } });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

module.exports = {
  getFeed,
  searchContent,
  toggleLike,
  getContentDetails,
  getSimilar,
  getProgress,
  setProgress,
  deleteProgress,
  getRecommendations,
};
