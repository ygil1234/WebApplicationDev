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
    return data.progress || { percent: 0, episodes: [] };
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
    await apiPost(`${API_BASE}/progress`, { profileId, contentExtId, season, episode, positionSec, durationSec, completed });
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
      card.innerHTML = `
        <div class="nf-card__cover">
          <img src="${coverSrc}" alt="${item.title || ''}" loading="lazy" onerror="this.onerror=null;this.style.display='none';" />
        </div>
        <div class="nf-card__meta">
          <div class="nf-card__title" title="${item.title || ''}">${item.title || ''}</div>
          <div class="nf-card__sub">${[item.year, item.type].filter(Boolean).join(' · ')}</div>
          <button class="btn btn-sm rounded-pill like-btn ${liked ? 'liked' : ''}" type="button" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'} ${item.title || ''}">
            <span class="heart" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" role="img">
                <path d="M12 21s-6.716-4.555-9.193-7.032C.977 12.139.5 10.96.5 9.708.5 6.817 2.817 4.5 5.708 4.5c1.522 0 2.974.62 4.042 1.688L12 8.439l2.25-2.25A5.726 5.726 0 0 1 18.292 4.5c2.891 0 5.208 2.317 5.208 5.208 0 1.252-.477 2.431-2.307 4.26C18.716 16.445 12 21 12 21z"></path>
              </svg>
            </span>
            <span class="like-count">${count}</span>
          </button>
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
    const episodesSection = document.getElementById('episodesSection');
    const episodesList = document.getElementById('episodesList');
    const actorsBox = document.getElementById('actors');
    const similarRow = document.getElementById('similarRow');

    let content = await loadDetails(extId, profileId);
    let progress = await loadProgress(extId, profileId).catch(() => ({ percent: 0, episodes: [] }));
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
        const percent = epProg ? percentFrom(epProg.positionSec, epProg.durationSec) : 0;
        row.innerHTML = `
          <div><strong>${epId}</strong> ${ep.title || ''}</div>
          <div class="d-flex align-items-center" style="gap:12px;">
            <div class="td-progress"><div class="td-progress__bar" style="width:${percent}%"></div></div>
            <button type="button" class="btn btn-sm btn-primary">Play</button>
          </div>
        `;
        row.querySelector('button').addEventListener('click', () => {
          playSource({ src: ep.videoPath, season: ep.season || 1, episode: ep.episode || 1, resume: true });
        });
        episodesList.appendChild(row);
      });
    }

    function playSource({ src, season = null, episode = null, resume = false }) {
      if (!src) return;
      const resolvedSrc = normalizePath(src);
      player.setAttribute('playsinline', '');
      if (playerSource) playerSource.src = resolvedSrc;
      player.src = resolvedSrc;
      playerSection.hidden = false;
      player.load();
      try { playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
      let seekTo = 0;
      if (resume) {
        if (season != null || episode != null) {
          const epProg = (progress.episodes || []).find(p => String(p.season) === String(season) && String(p.episode) === String(episode));
          if (epProg) seekTo = epProg.positionSec || 0;
        } else {
          seekTo = progress.lastPositionSec || 0;
        }
      }
      const onLoaded = () => {
        try { if (seekTo > 0 && player.duration && seekTo < player.duration) player.currentTime = seekTo; } catch {}
        player.play().catch(()=>{});
      };
      const onCanPlay = () => { onLoaded(); };
      player.removeEventListener('loadedmetadata', onLoaded);
      player.removeEventListener('canplay', onCanPlay);
      player.addEventListener('loadedmetadata', onLoaded);
      player.addEventListener('canplay', onCanPlay);

      // Progress saver
      let lastSent = 0;
      const save = async (completed = false) => {
        try {
          const pos = Math.floor(player.currentTime || 0);
          const dur = Math.floor(player.duration || 0);
          await setProgress({ profileId, contentExtId: extId, season, episode, positionSec: pos, durationSec: dur, completed });
          const pct = percentFrom(pos, dur);
          updateFeedProgressCache(profileId, extId, pct);
        } catch (e) { console.warn('progress save failed', e?.message); }
      };
      const onTime = async () => {
        const now = Date.now();
        if (now - lastSent > 5000) { lastSent = now; save(false); }
      };
      const onEnded = async () => { await save(true); player.removeEventListener('timeupdate', onTime); };
      const onError = () => { console.error('Video failed to load:', resolvedSrc); };
      player.removeEventListener('timeupdate', onTime);
      player.removeEventListener('ended', onEnded);
      player.removeEventListener('error', onError);
      player.addEventListener('timeupdate', onTime);
      player.addEventListener('ended', onEnded);
      player.addEventListener('error', onError);

      // If metadata is already available (cache), kick off immediately
      try {
        if (player.readyState >= 1) {
          onLoaded();
        } else {
          setTimeout(() => { if (player.readyState >= 1) onLoaded(); }, 300);
        }
      } catch {}
    }

    // Buttons
    if (hasEpisodes) {
      // Start = first episode; Continue = last
      btnStart.hidden = false;
      btnStart.addEventListener('click', () => {
        const first = episodes[0];
        playSource({ src: first?.videoPath, season: first?.season || 1, episode: first?.episode || 1, resume: false });
      });
      const epLatest = (progress.episodes || [])[0];
      if (epLatest) {
        btnContinue.hidden = false;
        btnContinue.addEventListener('click', () => {
          playSource({ src: episodes.find(e => String(e.season)===String(epLatest.season) && String(e.episode)===String(epLatest.episode))?.videoPath, season: epLatest.season, episode: epLatest.episode, resume: true });
        });
      }
    } else if (hasMovieVideo) {
      btnStart.hidden = false;
      btnStart.addEventListener('click', () => playSource({ src: content.videoPath, resume: false }));
      if (progress && (progress.lastPositionSec||0) > 0) {
        btnContinue.hidden = false;
        btnContinue.addEventListener('click', () => playSource({ src: content.videoPath, resume: true }));
      }
    } else {
      // No playable source
      btnStart.hidden = true;
      btnContinue.hidden = true;
    }

    // Rewatch: visible if overall percent = 100 (or flagged completed)
    if ((progress?.percent || 0) >= 98) {
      btnRewatch.hidden = false;
      btnRewatch.addEventListener('click', async () => {
        try {
          await resetProgress(profileId, extId);
          // Clear cached progress for feed
          updateFeedProgressCache(profileId, extId, 0);
          btnRewatch.hidden = true;
          btnContinue.hidden = true;
        } catch (e) { console.error('rewatch reset failed', e); }
      });
    }

    // Similar items
    renderSimilar(similarRow, similarItems);

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
