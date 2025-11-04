// JS/title.js
(function () {
  const API_BASE = "http://localhost:3000/api";

  function qs(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  function getProfile() {
    const id = localStorage.getItem('selectedProfileId');
    const name = localStorage.getItem('selectedProfileName');
    const avatar = localStorage.getItem('selectedProfileAvatar');
    return { id: id ? String(id) : '', name, avatar };
  }

  async function apiGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let msg = `POST ${url} -> ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }
  async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error(`DELETE ${url} -> ${res.status}`);
    return res.json();
  }

  function wikipediaLink(name) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(String(name || '').replace(/\s+/g, '_'))}`;
  }

  function normalizePath(p) {
    const s = String(p || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return s.startsWith('/') ? s : ('/' + s);
  }

  // Inject the shared header from feed.html and remove search/sort
  async function ensureSharedHeaderWithoutSearch() {
    try {
      // If a header already exists, skip
      if (document.querySelector('header.nf-nav')) return;
      const res = await fetch('feed.html', { credentials: 'same-origin', cache: 'no-cache' });
      if (!res.ok) return;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const header = doc.querySelector('header.nf-nav');
      if (!header) return;

      // Clone and strip search + A-Z toggle
      const clone = header.cloneNode(true);
      // Ensure brand logo navigates to main feed
      const brand = clone.querySelector('.nf-nav__brand');
      if (brand) brand.setAttribute('href', 'feed.html');
      // Remove toolbar (search + alpha)
      const toolbar = clone.querySelector('.nf-toolbar');
      if (toolbar) toolbar.remove();
      // Fallback: remove individual bits if toolbar structure changes
      clone.querySelectorAll('#searchBox, #searchBtn, #searchInput, .alpha-toggle').forEach(el => el.remove());

      // Mount before main or into mount placeholder if present
      const mount = document.getElementById('nav-mount');
      if (mount) {
        mount.replaceWith(clone);
      } else {
        const main = document.querySelector('main');
        document.body.insertBefore(clone, main || document.body.firstChild);
      }
    } catch (err) {
      // Fail silently; page still works without shared header
      console.warn('Shared header injection failed:', err);
    }
  }

  function setNavbarProfile() {
    const { id, name, avatar } = getProfile();
    if (!id || !name || !avatar) {
      window.location.href = 'profiles.html';
      return false;
    }
    const greetEl = document.getElementById('greet');
    if (greetEl) greetEl.textContent = `Hello, ${name}`;
    const avatarEl = document.getElementById('navAvatar');
    if (avatarEl) { avatarEl.src = avatar; avatarEl.alt = `${name} - Profile`; }
    return true;
  }

  function percentFrom(pos, dur) {
    if (!dur) return 0;
    return Math.min(100, Math.floor((Number(pos||0) / Number(dur||0)) * 100));
  }

  // Compute combined percent for series across ALL episodes.
  // If episode durations are fully known, use duration-weighted percent.
  // Otherwise, fall back to unweighted average of episode percents,
  // counting missing/unknown episodes as 0% (unless marked completed).
  function seriesCombinedPercent(contentEpisodes, progressEpisodes) {
    const eps = Array.isArray(contentEpisodes) ? contentEpisodes : [];
    const prog = Array.isArray(progressEpisodes) ? progressEpisodes : [];
    const keyOf = (s,e) => `${String(s)}-${String(e)}`;
    const n = eps.length;
    if (!n) return 0;

    const pmap = new Map(prog.map(p => [keyOf(p.season, p.episode), p]));
    const allDurKnown = eps.every(e => Number(e?.durationSec) > 0);

    if (allDurKnown) {
      let totalDur = 0;
      let watched = 0;
      for (const e of eps) {
        const p = pmap.get(keyOf(e.season, e.episode));
        const dur = Number(e.durationSec) || 0;
        const pos = p ? (p.completed ? dur : Number(p.positionSec) || 0) : 0;
        totalDur += dur;
        watched += Math.min(pos, dur);
      }
      if (!totalDur) return 0;
      return Math.min(100, Math.floor((watched / totalDur) * 100));
    }

    // Fallback: average percent per episode (unknown durations counted as 0%)
    let sumPct = 0;
    for (const e of eps) {
      const p = pmap.get(keyOf(e.season, e.episode));
      const dur = Number(e.durationSec) || Number(p?.durationSec) || 0;
      let epPct = 0;
      if (dur > 0) {
        epPct = percentFrom(p?.positionSec || 0, dur);
      } else if (p?.completed) {
        epPct = 100;
      } else {
        epPct = 0;
      }
      sumPct += Math.max(0, Math.min(100, epPct));
    }
    return Math.floor(sumPct / n);
  }

  function updateFeedProgressCache(profileId, extId, percent) {
    try {
      const key = `progress_by_${profileId}`;
      const data = JSON.parse(localStorage.getItem(key) || '{}');
      data[String(extId)] = Math.max(0, Math.min(100, Math.floor(percent)));
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }

  async function loadDetails(extId, profileId) {
    const data = await apiGet(`${API_BASE}/content/${encodeURIComponent(extId)}?profileId=${encodeURIComponent(profileId)}`);
    return data.item;
  }
  async function loadProgress(extId, profileId) {
    const data = await apiGet(`${API_BASE}/progress?profileId=${encodeURIComponent(profileId)}&contentExtId=${encodeURIComponent(extId)}`);
    const progress = data.progress || { percent: 0, episodes: [] };
    if (typeof progress.watched !== 'boolean') progress.watched = false;
    return progress;
  }
  async function loadSimilar(extId, profileId, limit = 10) {
    const data = await apiGet(`${API_BASE}/similar?extId=${encodeURIComponent(extId)}&profileId=${encodeURIComponent(profileId)}&limit=${limit}`);
    return data.items || [];
  }
  async function toggleLike(profileId, contentExtId, like) {
    const data = await apiPost(`${API_BASE}/likes/toggle`, { profileId, contentExtId, like: !!like });
    return data; // { ok, liked, likes }
  }
  async function setProgress({ profileId, contentExtId, season = null, episode = null, positionSec = 0, durationSec = 0, completed = false }) {
    const data = await apiPost(`${API_BASE}/progress`, { profileId, contentExtId, season, episode, positionSec, durationSec, completed });
    return data;
  }
  async function resetProgress(profileId, contentExtId) {
    await apiDelete(`${API_BASE}/progress?profileId=${encodeURIComponent(profileId)}&contentExtId=${encodeURIComponent(contentExtId)}`);
  }

  function renderSimilar(root, items) {
    root.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'nf-card nf-card--mini';
      const pid = String(item.extId || item.id);
      const count = Number(item.likes || 0);
      const liked = !!item.liked;
      card.dataset.extId = pid;
      const coverSrc = normalizePath(item.cover || item.imagePath || '');
      const watchedBadge = item.profileWatched ? '<span class="nf-card__watched">Watched</span>' : '';
      card.innerHTML = `
        <div class="nf-card__cover">
          <img src="${coverSrc}" alt="${item.title || ''}" loading="lazy" onerror="this.onerror=null;this.style.display='none';" />
        </div>
        <div class="nf-card__meta">
          <div class="nf-card__title" title="${item.title || ''}">${item.title || ''}</div>
          <div class="nf-card__sub">${[item.year, item.type].filter(Boolean).join(' · ')}</div>
          <div class="nf-card__actions">
            ${watchedBadge}
            <button class="btn btn-sm rounded-pill like-btn ${liked ? 'liked' : ''}" type="button" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'} ${item.title || ''}">
              <span class="heart" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" role="img">
                  <path d="M12 21s-6.716-4.555-9.193-7.032C.977 12.139.5 10.96.5 9.708.5 6.817 2.817 4.5 5.708 4.5c1.522 0 2.974.62 4.042 1.688L12 8.439l2.25-2.25A5.726 5.726 0 0 1 18.292 4.5c2.891 0 5.208 2.317 5.208 5.208 0 1.252-.477 2.431-2.307 4.26C18.716 16.445 12 21 12 21z"></path>
                </svg>
              </span>
              <span class="like-count">${count}</span>
            </button>
          </div>
        </div>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.like-btn')) return; // handled separately
        window.location.href = `title.html?extId=${encodeURIComponent(pid)}`;
      });
      root.appendChild(card);
    });
  }

  function bindLike(button, current, handlers) {
    const countEl = button.querySelector('.like-count');
    const wasLiked = !!current.liked;
    button.classList.toggle('liked', wasLiked);
    button.setAttribute('aria-pressed', String(wasLiked));
    if (typeof current.likes === 'number' && countEl) countEl.textContent = String(current.likes);

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      if (button.dataset.busy === '1') return;
      const goingLiked = !button.classList.contains('liked');
      const prevCount = Number(countEl?.textContent || '0') || 0;
      // optimistic
      button.classList.toggle('liked', goingLiked);
      button.setAttribute('aria-pressed', String(goingLiked));
      if (countEl) countEl.textContent = String(Math.max(0, prevCount + (goingLiked ? 1 : -1)));
      button.dataset.busy = '1';
      try {
        const { liked, likes } = await handlers.onToggle(goingLiked);
        button.classList.toggle('liked', !!liked);
        button.setAttribute('aria-pressed', String(!!liked));
        if (countEl) countEl.textContent = String(Math.max(0, Number(likes || 0)));
      } catch (err) {
        // rollback
        button.classList.toggle('liked', !goingLiked);
        button.setAttribute('aria-pressed', String(!goingLiked));
        if (countEl) countEl.textContent = String(prevCount);
        console.error('Like failed:', err);
      } finally {
        delete button.dataset.busy;
      }
    }, false);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Inject shared nav first so other scripts can wire it
    await ensureSharedHeaderWithoutSearch();
    if (!setNavbarProfile()) return;
    const { id: profileId } = getProfile();
    const extId = qs('extId');
    if (!extId) { window.location.href = 'feed.html'; return; }

    const titleName = document.getElementById('titleName');
    const titleMeta = document.getElementById('titleMeta');
    const titleDesc = document.getElementById('titleDesc');
    const titleBg   = document.getElementById('titleBg');
    const btnStart = document.getElementById('btnStart');
    const btnContinue = document.getElementById('btnContinue');
    const btnRewatch = document.getElementById('btnRewatch');
    const likeBtn = document.getElementById('likeBtn');
    const player = document.getElementById('player');
    const playerSource = document.getElementById('playerSource');
    const playerSection = document.getElementById('playerSection');
    const btnSeekBack = document.getElementById('btnSeekBack');
    const btnSeekFwd = document.getElementById('btnSeekFwd');
    const btnNextEpisode = document.getElementById('btnNextEpisode');
    const btnEpisodesOverlay = document.getElementById('btnEpisodesOverlay');
    const episodesDrawer = document.getElementById('episodesDrawer');
    const btnCloseEpisodes = document.getElementById('btnCloseEpisodes');
    const episodesDrawerList = document.getElementById('episodesDrawerList');
    const episodesSection = document.getElementById('episodesSection');
    const episodesList = document.getElementById('episodesList');
    const actorsBox = document.getElementById('actors');
    const similarRow = document.getElementById('similarRow');
    const watchedBadge = document.getElementById('titleWatchedBadge');

    let content = await loadDetails(extId, profileId);
    let progress = await loadProgress(extId, profileId).catch(() => ({ percent: 0, episodes: [], watched: false }));
    if (typeof progress.watched !== 'boolean') progress.watched = false;
    if (content.profileWatched) progress.watched = true;
    if (watchedBadge) watchedBadge.hidden = !progress.watched;
    const similarItems = await loadSimilar(extId, profileId, 12).catch(() => []);

    // Render main info
    titleName.textContent = content.title || '';
    const metaParts = [];
    if (content.year) metaParts.push(String(content.year));
    if (content.genres?.length) metaParts.push(content.genres.join(' · '));
    if (content.type) metaParts.push(content.type);
    if (content.rating) metaParts.push(content.rating);
    titleMeta.textContent = metaParts.join(' · ');
    titleDesc.textContent = content.plot || '';
    if (content.cover || content.imagePath) {
      titleBg.style.backgroundImage = `url('${normalizePath(content.cover || content.imagePath)}')`;
    }

    // Actors
    if (Array.isArray(content.actors) && content.actors.length) {
      actorsBox.innerHTML = '<strong>Cast:</strong> ' + content.actors.map(a => `<a href="${wikipediaLink(a)}" target="_blank" rel="noopener">${a}</a>`).join(', ');
    }

    // Like button binds
    bindLike(likeBtn, { liked: !!content.liked, likes: content.likes || 0 }, {
      onToggle: async (goingLiked) => {
        const { liked, likes } = await toggleLike(profileId, extId, goingLiked);
        content.liked = !!liked;
        content.likes = Number(likes || 0);
        return { liked, likes };
      }
    });

    // Determine playable sources
    // For Movies: content.videoPath
    // For Series: optional episodes array [{season, episode, title, videoPath}]
    const episodes = Array.isArray(content.episodes) ? content.episodes : [];
    const hasEpisodes = content.type && /series/i.test(content.type) && episodes.length > 0;
    const hasMovieVideo = !!content.videoPath;

    if (hasEpisodes) {
      episodesSection.hidden = false;
      episodesList.innerHTML = '';
      episodes.forEach(ep => {
        const row = document.createElement('div');
        row.className = 'td-episodes__item';
        const epId = `S${ep.season||1}E${ep.episode||1}`;
        const epProg = (progress.episodes || []).find(p => String(p.season) === String(ep.season||1) && String(p.episode) === String(ep.episode||1));
        const started = !!(epProg && ((epProg.positionSec||0) > 0 || epProg.completed));
        const percent = epProg ? percentFrom(epProg.positionSec, epProg.durationSec) : 0;
        const controlsHtml = started
          ? `<button type="button" class="btn btn-sm btn-primary ep-btn-resume">Resume</button>
             <button type="button" class="btn btn-sm btn-secondary ep-btn-restart">Restart</button>`
          : `<button type="button" class="btn btn-sm btn-primary ep-btn-play">Play</button>`;
        row.innerHTML = `
          <div><strong>${epId}</strong> ${ep.title || ''}</div>
          <div class="d-flex align-items-center" style="gap:12px;">
            <div class="td-progress"><div class="td-progress__bar" style="width:${percent}%"></div></div>
            ${controlsHtml}
          </div>
        `;
        const playBtn    = row.querySelector('.ep-btn-play');
        const resumeBtn  = row.querySelector('.ep-btn-resume');
        const restartBtn = row.querySelector('.ep-btn-restart');
        if (playBtn) playBtn.addEventListener('click', () => {
          playSource({ src: ep.videoPath, season: ep.season || 1, episode: ep.episode || 1, resume: false });
        });
        if (resumeBtn) resumeBtn.addEventListener('click', () => {
          playSource({ src: ep.videoPath, season: ep.season || 1, episode: ep.episode || 1, resume: true });
        });
        if (restartBtn) restartBtn.addEventListener('click', () => {
          playSource({ src: ep.videoPath, season: ep.season || 1, episode: ep.episode || 1, resume: false });
        });
        episodesList.appendChild(row);
      });
    }

    // Track current episode ref for next-episode button and drawer highlight
    let currentSeason = null;
    let currentEpisodeNum = null;

    function currentEpisodeIndex() {
      if (!hasEpisodes) return -1;
      const s = currentSeason;
      const e = currentEpisodeNum;
      return episodes.findIndex(ep => String(ep.season||1) === String(s) && String(ep.episode||1) === String(e));
    }

    function nextEpisodeObj() {
      const idx = currentEpisodeIndex();
      if (idx >= 0 && idx + 1 < episodes.length) return episodes[idx + 1];
      return null;
    }

    function updateNextButton() {
      if (!btnNextEpisode) return;
      if (!hasEpisodes) { btnNextEpisode.hidden = true; return; }
      const next = nextEpisodeObj();
      if (!next) { btnNextEpisode.hidden = true; return; }
      btnNextEpisode.title = `Next: S${next.season||1}E${next.episode||1}`;
      btnNextEpisode.hidden = false;
    }

    function highlightDrawerCurrent() {
      if (!episodesDrawerList) return;
      try {
        episodesDrawerList.querySelectorAll('.is-current').forEach(el => el.classList.remove('is-current'));
        const idx = currentEpisodeIndex();
        if (idx >= 0) {
          const node = episodesDrawerList.querySelector(`[data-epi-idx="${idx}"]`);
          if (node) node.classList.add('is-current');
        }
      } catch {}
    }

    function renderEpisodesDrawer() {
      if (!episodesDrawerList) return;
      episodesDrawerList.innerHTML = '';
      episodes.forEach((ep, i) => {
        const row = document.createElement('div');
        row.className = 'td-episodes__item';
        row.dataset.epiIdx = String(i);
        const epId = `S${ep.season||1}E${ep.episode||1}`;
        const epProg = (progress.episodes || []).find(p => String(p.season) === String(ep.season||1) && String(p.episode) === String(ep.episode||1));
        const percent = epProg ? percentFrom(epProg.positionSec, epProg.durationSec) : 0;
        row.innerHTML = `
          <div><strong>${epId}</strong> ${ep.title || ''}</div>
          <div class="d-flex align-items-center" style="gap:12px;">
            <div class="td-progress"><div class="td-progress__bar" style="width:${percent}%"></div></div>
            <button type="button" class="btn btn-sm btn-primary epd-btn-play">Play</button>
          </div>
        `;
        row.querySelector('.epd-btn-play')?.addEventListener('click', () => {
          playSource({ src: ep.videoPath, season: ep.season || 1, episode: ep.episode || 1, resume: !!(epProg && (epProg.positionSec||0) > 0) });
          if (episodesDrawer) episodesDrawer.hidden = true;
        });
        episodesDrawerList.appendChild(row);
      });
      highlightDrawerCurrent();
    }

    function playSource({ src, season = null, episode = null, resume = false }) {
      if (!src) return;
      const resolvedSrc = normalizePath(src);

      // Clean up previous handlers to avoid stacking and autoplay loops
      if (player._handlers) {
        const h = player._handlers;
        try { player.removeEventListener('loadedmetadata', h.onLoaded); } catch {}
        try { player.removeEventListener('canplay', h.onCanPlay); } catch {}
        try { player.removeEventListener('timeupdate', h.onTime); } catch {}
        try { player.removeEventListener('ended', h.onEnded); } catch {}
        try { player.removeEventListener('error', h.onError); } catch {}
      }

      player.setAttribute('playsinline', '');
      try { player.setAttribute('webkit-playsinline', ''); } catch {}
      try { player.playsInline = true; } catch {}
      try { player.autoplay = true; } catch {}

      // Reset and set source
      try { player.pause(); } catch {}
      if (playerSource) playerSource.src = resolvedSrc;
      player.src = resolvedSrc;
      playerSection.hidden = false;
      player.load();
      try { playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}

      // Track current episode ref
      currentSeason = season != null ? (season || 1) : null;
      currentEpisodeNum = episode != null ? (episode || 1) : null;
      updateNextButton();
      highlightDrawerCurrent();

      // Resume position
      let seekTo = 0;
      if (resume) {
        if (season != null || episode != null) {
          const epProg = (progress.episodes || []).find(p => String(p.season) === String(season) && String(p.episode) === String(episode));
          if (epProg) seekTo = epProg.positionSec || 0;
        } else {
          seekTo = progress.lastPositionSec || 0;
        }
      }

      // Single guarded autoplay attempt
      let autoplayPending = true;
      const attemptPlay = () => {
        if (!autoplayPending) return;
        autoplayPending = false;
        try {
          const p = player.play && player.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {}
      };

      const onLoaded = () => {
        try {
          if (player.duration && seekTo > 0) {
            const safeSeek = Math.min(seekTo, Math.max(0, player.duration - 1));
            if (safeSeek >= 0 && safeSeek < player.duration) player.currentTime = safeSeek;
          }
        } catch {}
        attemptPlay();
      };
      const onCanPlay = () => { attemptPlay(); };

      // Progress saver
      let lastSent = 0;
      const save = async (completed = false) => {
        try {
          const pos = Math.floor(player.currentTime || 0);
          const dur = Math.floor(player.duration || 0);
          const res = await setProgress({ profileId, contentExtId: extId, season, episode, positionSec: pos, durationSec: dur, completed });
          const pct = percentFrom(pos, dur);
          updateFeedProgressCache(profileId, extId, res?.watched ? 100 : pct);
          if (res && typeof res.watched === 'boolean') {
            progress.watched = !!res.watched;
            if (res.watched) {
              content.profileWatched = true;
              if (watchedBadge) watchedBadge.hidden = false;
              btnRewatch.hidden = false;
              btnStart.hidden = true;
              btnContinue.hidden = true;
            }
          }
        } catch (e) { console.warn('progress save failed', e?.message); }
      };
      const onTime = () => {
        const now = Date.now();
        if (now - lastSent > 5000) { lastSent = now; save(false); }
      };
      const onEnded = async () => { await save(true); try { player.removeEventListener('timeupdate', onTime); } catch {} ; updateNextButton(); };
      const onError = () => { console.error('Video failed to load:', resolvedSrc); };

      player.addEventListener('loadedmetadata', onLoaded);
      player.addEventListener('canplay', onCanPlay);
      player.addEventListener('timeupdate', onTime);
      player.addEventListener('ended', onEnded);
      player.addEventListener('error', onError);

      // Keep references for proper cleanup next call
      player._handlers = { onLoaded, onCanPlay, onTime, onEnded, onError };

      // Immediate attempt (user gesture) — guarded
      attemptPlay();
    }

    // Buttons
    if (btnSeekBack) btnSeekBack.addEventListener('click', (e) => {
      e.preventDefault();
      try { player.currentTime = Math.max(0, (player.currentTime || 0) - 10); } catch {}
    });
    if (btnSeekFwd) btnSeekFwd.addEventListener('click', (e) => {
      e.preventDefault();
      const dur = Number(player.duration || 0);
      try { player.currentTime = Math.min(dur ? (dur - 0.5) : (player.currentTime||0)+10, (player.currentTime || 0) + 10); } catch {}
    });
    if (btnEpisodesOverlay && episodesDrawer) {
      btnEpisodesOverlay.addEventListener('click', (e) => {
        e.preventDefault();
        if (!hasEpisodes) return;
        if (episodesDrawer.hidden) renderEpisodesDrawer();
        episodesDrawer.hidden = !episodesDrawer.hidden;
      });
    }
    if (btnCloseEpisodes && episodesDrawer) {
      btnCloseEpisodes.addEventListener('click', (e) => {
        e.preventDefault();
        episodesDrawer.hidden = true;
      });
    }
    if (btnNextEpisode) {
      btnNextEpisode.addEventListener('click', (e) => {
        e.preventDefault();
        const next = nextEpisodeObj();
        if (next) playSource({ src: next.videoPath, season: next.season || 1, episode: next.episode || 1, resume: false });
      });
    }
    // Compute overall percent for gating buttons
    let overallPercent = 0;
    if (hasEpisodes) overallPercent = seriesCombinedPercent(episodes, progress.episodes || []);
    else overallPercent = percentFrom(progress.lastPositionSec || 0, progress.lastDurationSec || 0);
    if (!overallPercent) overallPercent = Number(progress?.percent || 0);

    const watchedFlag = Boolean(content.profileWatched || progress?.watched);
    if (watchedFlag) {
      overallPercent = 100;
      progress.percent = 100;
    }

    if (watchedBadge) watchedBadge.hidden = !watchedFlag;

    const showRewatchNow = watchedFlag || overallPercent >= 97; // show only if ~finished
    const finishedOver98 = watchedFlag || overallPercent > 98;  // stricter rule for Continue
    const hasStartedSeries = Array.isArray(progress?.episodes) && progress.episodes.some(e => (e.positionSec || 0) > 0);
    const hasStartedMovie  = (progress?.lastPositionSec || 0) > 0;

    // Rewatch: visible only when ~finished
    btnRewatch.hidden = !showRewatchNow;

    if (hasEpisodes) {
      const epLatest = (progress.episodes || [])[0];
      const canContinue = !!(epLatest && hasStartedSeries && !finishedOver98);
      // Start only if cannot continue (no ongoing watch)
      btnStart.hidden = canContinue;
      if (!btnStart.hidden) {
        btnStart.addEventListener('click', () => {
          const first = episodes[0];
          playSource({ src: first?.videoPath, season: first?.season || 1, episode: first?.episode || 1, resume: false });
        });
      }
      // Continue only if user started and not almost finished
      btnContinue.hidden = !canContinue;
      if (!btnContinue.hidden) {
        btnContinue.addEventListener('click', () => {
          playSource({ src: episodes.find(e => String(e.season)===String(epLatest.season) && String(e.episode)===String(epLatest.episode))?.videoPath, season: epLatest.season, episode: epLatest.episode, resume: true });
        });
      }
    } else if (hasMovieVideo) {
      const canContinue = !!(hasStartedMovie && !finishedOver98);
      // Start only if cannot continue
      btnStart.hidden = canContinue;
      if (!btnStart.hidden) {
        btnStart.addEventListener('click', () => playSource({ src: content.videoPath, resume: false }));
      }
      // Continue only if user started and not almost finished
      btnContinue.hidden = !canContinue;
      if (!btnContinue.hidden) {
        btnContinue.addEventListener('click', () => playSource({ src: content.videoPath, resume: true }));
      }
    } else {
      // No playable source
      btnStart.hidden = true;
      btnContinue.hidden = true;
    }

    // Rewatch handler: reset all watch records and hide Continue
    btnRewatch.addEventListener('click', async () => {
      try {
        await resetProgress(profileId, extId);
        updateFeedProgressCache(profileId, extId, 0);
        // Reset local state
        progress = { percent: 0, lastPositionSec: 0, lastDurationSec: 0, lastEpisodeRef: null, episodes: [] };
        // Update UI: no continue available after reset
        btnContinue.hidden = true;
        btnStart.hidden = false;
        btnRewatch.hidden = true;
        try { episodesList?.querySelectorAll('.td-progress__bar').forEach(el => el.style.width = '0%'); } catch {}
        // Immediately play from the start
        if (hasEpisodes) {
          const first = episodes[0];
          playSource({ src: first?.videoPath, season: first?.season || 1, episode: first?.episode || 1, resume: false });
        } else if (hasMovieVideo) {
          playSource({ src: content.videoPath, resume: false });
        }
      } catch (e) {
        console.error('rewatch reset failed', e);
      }
    });

    // Update visibility of overlay controls for non-series
    if (!hasEpisodes) {
      if (btnEpisodesOverlay) btnEpisodesOverlay.hidden = true;
      if (btnNextEpisode) btnNextEpisode.hidden = true;
    } else {
      updateNextButton();
    }

    // Similar items
    renderSimilar(similarRow, similarItems);

    // Add row arrows for Similar section
    (function initSimilarRowArrows() {
      const scroller = document.getElementById('similarRow');
      if (!scroller) return;
      const left = document.querySelector('#similarSection .nf-row__arrow--left');
      const right = document.querySelector('#similarSection .nf-row__arrow--right');
      const ROW_SCROLL_STEP = 5;

      function setDisabled(btn, disabled) {
        if (!btn) return;
        btn.disabled = !!disabled;
        btn.classList.toggle('is-disabled', !!disabled);
        btn.setAttribute('aria-disabled', String(!!disabled));
      }
      function updateArrows() {
        const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
        const x = scroller.scrollLeft;
        setDisabled(left,  x <= 5);
        setDisabled(right, x >= (maxScroll - 5));
      }
      function getGapPx() {
        const styles = window.getComputedStyle(scroller);
        const gapStr = styles.columnGap || styles.gap || '0';
        const v = parseFloat(gapStr);
        return Number.isFinite(v) ? v : 0;
      }
      function cardWidthPx() {
        const card = scroller.querySelector('.nf-card');
        if (!card) return scroller.clientWidth || 0;
        const rect = card.getBoundingClientRect();
        return rect.width;
      }
      function scrollAmountPx() {
        const cardW = cardWidthPx();
        const gap = getGapPx();
        const cards = Math.max(1, ROW_SCROLL_STEP);
        const totalGap = gap * Math.max(0, cards - 1);
        const amount = (cardW * cards) + totalGap;
        return amount > 0 ? amount : (scroller.clientWidth || 0);
      }
      requestAnimationFrame(updateArrows);
      scroller.addEventListener('scroll', () => {
        requestAnimationFrame(updateArrows);
      });
      if (left) left.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (left.disabled) return;
        scroller.scrollBy({ left: -scrollAmountPx(), behavior: 'smooth' });
        setTimeout(updateArrows, 350);
      });
      if (right) right.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (right.disabled) return;
        scroller.scrollBy({ left: scrollAmountPx(), behavior: 'smooth' });
        setTimeout(updateArrows, 350);
      });
      window.addEventListener('resize', () => requestAnimationFrame(updateArrows));
    })();

    // Likes in similar list (delegated)
    document.getElementById('similarSection')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.like-btn');
      if (!btn) return;
      e.preventDefault();
      const card = btn.closest('.nf-card');
      if (!card) return;
      const pid = String(card.dataset.extId || '');
      if (!pid) return;
      if (btn.dataset.busy === '1') return;
      const countEl = btn.querySelector('.like-count');
      const wasLiked = btn.classList.contains('liked');
      const goingLiked = !wasLiked;
      const prev = Number(countEl?.textContent || '0') || 0;
      btn.classList.toggle('liked', goingLiked);
      btn.setAttribute('aria-pressed', String(goingLiked));
      if (countEl) countEl.textContent = String(Math.max(0, prev + (goingLiked ? 1 : -1)));
      btn.dataset.busy = '1';
      try {
        const { liked, likes } = await toggleLike(profileId, pid, goingLiked);
        btn.classList.toggle('liked', !!liked);
        btn.setAttribute('aria-pressed', String(!!liked));
        if (countEl) countEl.textContent = String(Math.max(0, Number(likes || 0)));
      } catch (err) {
        // rollback
        btn.classList.toggle('liked', wasLiked);
        btn.setAttribute('aria-pressed', String(wasLiked));
        if (countEl) countEl.textContent = String(prev);
      } finally {
        delete btn.dataset.busy;
      }
    }, false);
  });
})();
