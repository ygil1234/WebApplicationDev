const axios = require('axios');

const Content = require('../models/Video');
const { writeLog, syncContentJsonWithDoc, seedContentIfNeeded } = require('../utils/helpers');
const { OMDB_API_KEY } = require('../config/config');

function normalizeType(rawType) {
  const value = String(rawType || '').trim();
  if (/^movie$/i.test(value)) return 'Movie';
  if (/^series$/i.test(value)) return 'Series';
  return value;
}

function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function computeNextExtIdForType(rawType) {
  const normalizedType = normalizeType(rawType);
  const isMovie = normalizedType === 'Movie';
  const isSeries = normalizedType === 'Series';
  if (!isMovie && !isSeries) {
    throw new Error('Unsupported type for automatic ID assignment');
  }
  const prefix = isMovie ? 'm' : 's';
  const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const docs = await Content.find({ type: normalizedType }, { extId: 1 }).lean();
  let maxNum = 0;
  for (const doc of docs) {
    const match = regex.exec(String(doc.extId || ''));
    if (!match) continue;
    const num = Number.parseInt(match[1], 10);
    if (Number.isFinite(num) && num > maxNum) {
      maxNum = num;
    }
  }
  return `${prefix}${maxNum + 1}`;
}

async function listContentSummaries(req, res) {
  try {
    const filter = {};
    const rawType = String(req.query.type || '').trim();
    if (rawType) {
      filter.type = normalizeType(rawType);
    }

    const docs = await Content.find(filter, { extId: 1, title: 1, type: 1 })
      .sort({ title: 1, extId: 1 })
      .lean();

    return res.json({
      ok: true,
      data: docs.map((doc) => ({
        extId: doc.extId,
        title: doc.title,
        type: doc.type,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/content error:', err);
    await writeLog({
      level: 'error',
      event: 'content_admin_list',
      userId: req.session.userId,
      details: { error: err.message },
    });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function getContentByExtId(req, res) {
  try {
    const extId = String(req.params.extId || '').trim();
    if (!extId) {
      return res.status(400).json({ ok: false, error: 'extId parameter is required.' });
    }

    const doc = await Content.findOne({ extId }).lean();
    if (!doc) {
      return res.status(404).json({ ok: false, error: 'Content not found.' });
    }

    const sortedEpisodes = Array.isArray(doc.episodes)
      ? [...doc.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode)
      : [];

    return res.json({
      ok: true,
      data: {
        extId: doc.extId,
        title: doc.title,
        year: doc.year,
        genres: doc.genres,
        type: doc.type,
        cover: doc.cover || doc.imagePath || '',
        imagePath: doc.imagePath || '',
        videoPath: doc.videoPath || '',
        plot: doc.plot || '',
        director: doc.director || '',
        actors: doc.actors || [],
        rating: doc.rating || '',
        episodes: sortedEpisodes.map((ep) => ({
          season: ep.season,
          episode: ep.episode,
          title: ep.title,
          videoPath: ep.videoPath,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/admin/content/:extId error:', err);
    await writeLog({
      level: 'error',
      event: 'content_admin_lookup',
      userId: req.session.userId,
      details: { error: err.message, extId: req.params.extId },
    });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function createOrUpdateContent(req, res) {
  try {
    const { title, year, genres } = req.body;
    const type = normalizeType(req.body.type);
    const extIdInput = typeof req.body.extId === 'string' ? req.body.extId.trim() : '';

    if (!title || !year || !genres || !type) {
      return res.status(400).json({
        ok: false,
        error: 'All text fields are required (title, year, genres, type).',
      });
    }

    const imageFile = req.files?.imageFile?.[0];
    const videoFile = req.files?.videoFile?.[0];

    let extId = extIdInput;
    let existingContent = null;
    if (extId) {
      existingContent = await Content.findOne({ extId }).lean();
    }

    const autoGenerateExtId = !extId;

    if (autoGenerateExtId) {
      try {
        extId = await computeNextExtIdForType(type);
      } catch (err) {
        console.error('Auto ID generation failed:', err);
        return res.status(400).json({
          ok: false,
          error: 'Unable to generate an External ID for this type.',
        });
      }
    } else if (!existingContent) {
      existingContent = await Content.findOne({ extId }).lean();
    }

    if (!existingContent) {
      const isMovie = /movie/i.test(String(type || ''));
      if (!imageFile || (isMovie && !videoFile)) {
        return res.status(400).json({
          ok: false,
          error: isMovie
            ? 'Image and Video files are required when creating a Movie.'
            : 'Image file is required when creating a Series.',
        });
      }
    }

    let omdbData = {};
    if (OMDB_API_KEY) {
      try {
        const url = `http://www.omdbapi.com/?apikey=${OMDB_API_KEY}&t=${encodeURIComponent(title)}&y=${year}`;
        const response = await axios.get(url);
        if (response.data && response.data.Response === 'True') {
          const ratingRaw = Number.parseFloat(response.data.imdbRating);
          const hasRating = Number.isFinite(ratingRaw);
          omdbData = {
            plot: response.data.Plot,
            director: response.data.Director,
            actors: response.data.Actors
              ? response.data.Actors.split(',').map((s) => s.trim())
              : [],
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
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401) {
          console.warn('[OMDb] Invalid or unauthorized API key - skipping metadata enrichment.');
        } else {
          console.error('[OMDb] Error fetching data:', err.message);
        }
        omdbData = {};
      }
    } else {
      console.warn('[OMDb] OMDB_API_KEY is not set. Skipping rating fetch.');
    }

    const doc = {
      title,
      year: Number(year),
      genres: Array.isArray(genres)
        ? genres.filter(Boolean)
        : String(genres)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      type,
      ...omdbData,
      extId,
    };

    if (imageFile) {
      const assetPath = `/uploads/images/${imageFile.filename}`;
      doc.imagePath = assetPath;
      doc.cover = assetPath;
    }

    if (videoFile) {
      const isMovie = /movie/i.test(String(type || ''));
      if (isMovie) {
        doc.videoPath = `/uploads/videos/${videoFile.filename}`;
      }
    }

    const shouldRetryAutoId = autoGenerateExtId && !existingContent;
    let upsertRes;
    let attempts = 0;
    const maxAttempts = 5;
    let currentExtId = doc.extId;

    while (attempts < maxAttempts) {
      try {
        doc.extId = currentExtId;
        upsertRes = await Content.updateOne(
          { extId: doc.extId },
          {
            $set: doc,
            $setOnInsert: { likes: 0 },
          },
          { upsert: true }
        );
        extId = doc.extId;
        break;
      } catch (err) {
        if (shouldRetryAutoId && err?.code === 11000) {
          attempts += 1;
          currentExtId = await computeNextExtIdForType(type);
          continue;
        }
        throw err;
      }
    }

    if (!upsertRes) {
      throw new Error('Content could not be saved after multiple attempts.');
    }

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
      await writeLog({
        event: 'content_create',
        userId: req.session.userId,
        details: logDetails,
      });
      return res.status(201).json({ ok: true, data: finalDoc, action: 'created' });
    }

    await writeLog({
      event: 'content_update',
      userId: req.session.userId,
      details: logDetails,
    });
    return res.status(200).json({ ok: true, data: finalDoc, action: 'updated' });
  } catch (err) {
    console.error('POST /api/admin/content error:', err);
    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: 'A content item with this External ID already exists.',
      });
    }
    await writeLog({
      level: 'error',
      event: 'content_admin_op',
      userId: req.session.userId,
      details: { error: err.message },
    });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function deleteContent(req, res) {
  try {
    const type = normalizeType(req.body.type);
    const extIdRaw = typeof req.body.extId === 'string' ? req.body.extId.trim() : '';
    const titleRaw = typeof req.body.title === 'string' ? req.body.title.trim() : '';

    if (!type) {
      return res.status(400).json({ ok: false, error: 'Type is required (Movie or Series).' });
    }

    const hasExtId = Boolean(extIdRaw);
    const hasTitle = Boolean(titleRaw);
    if (!hasExtId && !hasTitle) {
      return res.status(400).json({ ok: false, error: 'Provide either an External ID or a title.' });
    }
    if (hasExtId && hasTitle) {
      return res.status(400).json({ ok: false, error: 'Choose only one identifier: title or External ID.' });
    }

    const query = { type };
    if (hasExtId) {
      query.extId = extIdRaw;
    } else if (hasTitle) {
      query.title = { $regex: new RegExp(`^${escapeRegExp(titleRaw)}$`, 'i') };
    }

    const deleted = await Content.findOneAndDelete(query).lean();
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'No matching content found.' });
    }

    await writeLog({
      level: 'info',
      event: 'content_admin_delete',
      userId: req.session.userId,
      details: { type, extId: deleted.extId, title: deleted.title },
    });

    return res.json({
      ok: true,
      data: {
        extId: deleted.extId,
        title: deleted.title,
        type: deleted.type,
      },
    });
  } catch (err) {
    console.error('DELETE /api/admin/content error:', err);
    await writeLog({
      level: 'error',
      event: 'content_admin_delete_fail',
      userId: req.session.userId,
      details: { error: err.message },
    });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

async function upsertEpisode(req, res) {
  try {
    const { seriesExtId, season, episode, title } = req.body || {};
    const videoFile = req.files?.videoFile?.[0];
    if (!seriesExtId || !season || !episode || !videoFile) {
      return res.status(400).json({
        ok: false,
        error: 'seriesExtId, season, episode and videoFile are required',
      });
    }

    const series = await Content.findOne({ extId: String(seriesExtId) });
    if (!series) return res.status(404).json({ ok: false, error: 'Series not found' });
    if (!/series/i.test(series.type || '')) {
      return res.status(400).json({ ok: false, error: 'Target content is not a Series' });
    }

    const durationRaw = Number.parseInt(
      (req.body && (req.body.durationSec ?? req.body.duration)) ?? '0',
      10
    );
    const ep = {
      season: Number(season),
      episode: Number(episode),
      title: String(title || `Episode ${episode}`),
      videoPath: `/uploads/videos/${videoFile.filename}`,
      durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
    };

    const filtered = (series.episodes || []).filter(
      (e) => !(Number(e.season) === ep.season && Number(e.episode) === ep.episode)
    );
    filtered.push(ep);
    filtered.sort((a, b) => a.season - b.season || a.episode - b.episode);
    series.episodes = filtered;
    await series.save();

    const updatedSeries = await Content.findOne({ extId: String(seriesExtId) }).lean();
    if (!updatedSeries) {
      throw new Error('Series saved but could not be reloaded');
    }

    try {
      await syncContentJsonWithDoc(updatedSeries, {
        overrideEpisodes: updatedSeries.episodes || [],
      });
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

    await writeLog({
      event: 'episode_upsert',
      userId: req.session.userId,
      details: { seriesExtId, season: ep.season, episode: ep.episode, title: ep.title },
    });
    return res.status(201).json({ ok: true, seriesExtId, episode: ep });
  } catch (err) {
    console.error('POST /api/admin/episodes error:', err);
    await writeLog({
      level: 'error',
      event: 'episode_admin_op',
      userId: req.session.userId,
      details: { error: err.message },
    });
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

module.exports = {
  listContentSummaries,
  getContentByExtId,
  createOrUpdateContent,
  deleteContent,
  upsertEpisode,
};
