const path = require('path');
const fs = require('fs/promises');

const Content = require('../models/Video');
const Log = require('../models/Log');
const User = require('../models/User');

const { CONTENT_JSON_CANDIDATES, SERVER_DIR, SEED_CONTENT } = require('../config/config');

let __seedCache = null;

function sanitizeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePositiveInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function writeLog({ level = 'info', event, userId = null, profileId = null, details = {} }) {
  try {
    await Log.create({ level, event, userId, profileId, details });
  } catch (err) {
    console.warn('[log] skip:', err.message);
  }
}

async function loadSeedCache() {
  if (__seedCache) return __seedCache;
  try {
    let raw = null;
    for (const candidate of CONTENT_JSON_CANDIDATES) {
      try {
        raw = await fs.readFile(candidate, 'utf-8');
        break;
      } catch {
        /* ignore */
      }
    }
    if (!raw) {
      __seedCache = new Map();
      return __seedCache;
    }
    const data = JSON.parse(raw);
    const arr = Array.isArray(data)
      ? data
      : (data && typeof data === 'object'
        ? Object.values(data).find(Array.isArray)
        : []);
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

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

async function resolveCoverForDoc(doc) {
  const pick = (doc && (doc.cover || doc.imagePath)) ? (doc.cover || doc.imagePath) : '';
  const candidate = String(pick || '').trim();

  if (candidate && isHttpUrl(candidate)) return candidate;
  if (/^\/?IMG\//i.test(candidate)) return candidate;

  if (candidate) {
    try {
      const rel = candidate.replace(/^\/+/g, '');
      const fsRel = rel.replace(/^IMG\//i, 'img/');
      const abs = path.join(SERVER_DIR, '..', 'public', fsRel);
      await fs.access(abs);
      return candidate;
    } catch {
      // fallback below
    }
  }

  try {
    const seed = await getSeedItem(doc?.extId || doc?.id || '');
    const fb = seed?.cover || seed?.poster || seed?.image || seed?.img || '';
    if (fb) return fb;
  } catch {
    /* ignore */
  }

  return candidate;
}

async function findMostRecentVideoUpload() {
  try {
    const dir = path.join(SERVER_DIR, '..', 'public', 'uploads', 'videos');
    const files = await fs.readdir(dir);
    const mp4s = files.filter((f) => /\.mp4$/i.test(f));
    if (!mp4s.length) return null;
    const stats = await Promise.all(
      mp4s.map(async (f) => ({ f, s: await fs.stat(path.join(dir, f)) }))
    );
    stats.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
    return `/uploads/videos/${stats[0].f}`;
  } catch {
    return null;
  }
}

async function readJSON(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

async function ensureFileJSON(filePath, initial) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonAtomic(filePath, initial);
  }
}

async function resolveUserId(userIdOrName, session) {
  let value = String(userIdOrName || '').trim();

  if (!value) {
    if (session?.userId) return String(session.userId);
    if (session?.username) value = String(session.username);
  }
  if (!value) return '';

  if (/^[0-9a-fA-F]{24}$/.test(value)) return value;

  const re = new RegExp(`^${sanitizeRegex(value)}$`, 'i');
  const user = await User.findOne({ $or: [{ email: re }, { username: re }] }, '_id').lean();
  return user ? String(user._id) : '';
}

function unwrapContentJsonRoot(data) {
  if (Array.isArray(data)) return { items: data, wrap: null };
  if (data && typeof data === 'object') {
    const entry = Object.entries(data).find(([, value]) => Array.isArray(value));
    if (entry) return { items: entry[1], wrap: { key: entry[0], container: data } };
  }
  return { items: [], wrap: null };
}

async function readContentJsonFile() {
  for (const candidate of CONTENT_JSON_CANDIDATES) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const data = JSON.parse(raw);
      const { items, wrap } = unwrapContentJsonRoot(data);
      return { items: Array.isArray(items) ? [...items] : [], wrap, usedPath: candidate };
    } catch {
      /* ignore */
    }
  }
  return { items: [], wrap: null, usedPath: CONTENT_JSON_CANDIDATES[0] };
}

async function writeContentJsonFile(targetPath, items, wrap) {
  const payload = wrap ? { ...wrap.container, [wrap.key]: items } : items;
  await writeJsonAtomic(targetPath, payload);
}

function normalizeEpisodeRecord(episode) {
  if (!episode) return null;
  const season = Number.parseInt(episode.season ?? episode.Season ?? episode.seasonNumber, 10);
  const epNumber = Number.parseInt(episode.episode ?? episode.Episode ?? episode.episodeNumber, 10);
  if (!Number.isFinite(season) || !Number.isFinite(epNumber)) return null;
  const durationRaw = Number.parseFloat(
    episode.durationSec ?? episode.duration ?? episode.length ?? episode.runtime
  );
  return {
    season,
    episode: epNumber,
    title: String(episode.title ?? episode.name ?? `Episode ${epNumber}`),
    videoPath: String(episode.videoPath ?? episode.file ?? episode.path ?? '').trim(),
    durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0,
  };
}

function buildJsonEntryFromDoc(doc, prevEntry = {}, { overrideEpisodes } = {}) {
  const entry = {
    ...prevEntry,
    id: doc.extId,
    extId: doc.extId,
    title: doc.title,
    year: doc.year,
    genres: doc.genres,
    cover: doc.cover,
    image: doc.imagePath,
    rating: doc.rating,
    ratingValue: doc.ratingValue,
    plot: doc.plot,
    director: doc.director,
    actors: doc.actors,
    type: doc.type,
    videoPath: doc.videoPath,
  };
  if (overrideEpisodes) {
    entry.episodes = overrideEpisodes;
  } else if (Array.isArray(doc.episodes)) {
    entry.episodes = doc.episodes;
  }
  return entry;
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

async function seedContentIfNeeded({ force = false } = {}) {
  if (!force && !SEED_CONTENT) return;
  try {
    const { items: arr, usedPath } = await readContentJsonFile();

    const toDoc = (it) => {
      const title = it.title || it.name || 'Untitled';
      const extId = String(it.id ?? it.extId ?? title).trim();
      const genres = Array.isArray(it.genres)
        ? it.genres
        : Array.isArray(it.genre)
          ? it.genre
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

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const it of arr) {
      const doc = toDoc(it);
      if (!doc.extId || !doc.title) {
        skipped++;
        continue;
      }

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
    console.log(
      `[seed] from ${usedPath} → inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}, total: ${total}`
    );
  } catch (err) {
    console.warn('[seed] skip:', err.message);
  }
}

module.exports = {
  sanitizeRegex,
  parsePositiveInt,
  writeLog,
  loadSeedCache,
  getSeedItem,
  isHttpUrl,
  resolveCoverForDoc,
  findMostRecentVideoUpload,
  readJSON,
  writeJsonAtomic,
  ensureFileJSON,
  resolveUserId,
  unwrapContentJsonRoot,
  readContentJsonFile,
  writeContentJsonFile,
  normalizeEpisodeRecord,
  buildJsonEntryFromDoc,
  syncContentJsonWithDoc,
  seedContentIfNeeded,
};
