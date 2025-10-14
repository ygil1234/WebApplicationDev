// JS/feed.js – Matala 4 (Feed) 

document.addEventListener("DOMContentLoaded", async () => {
  // ===== 0) Guard anchors (prevent default on dead links)
  document.addEventListener('click', (e) => {
    const allow = e.target.closest('#alphaToggle, label[for="alphaToggle"], .sort-toggle, [data-allow-default], .allow-default, button, input, select, textarea');
    if (allow) return;
    const a = e.target.closest('a');
    if (!a) return;
    if (a.id === 'logoutLink') return;
    const href = (a.getAttribute('href') || '').trim().toLowerCase();
    const isDead = href === '' || href === '#' || href === 'javascript:void(0)';
    if (isDead) e.preventDefault();
  }, true);

  // ===== 1) Session / Navbar
  const API_BASE = "http://localhost:3000/api";

  const selectedIdStr   = localStorage.getItem("selectedProfileId");
  const selectedId      = selectedIdStr ? Number(selectedIdStr) : NaN;
  const profileName     = localStorage.getItem("selectedProfileName");
  const profileAvatar   = localStorage.getItem("selectedProfileAvatar");

  if (!selectedId || Number.isNaN(selectedId) || !profileName || !profileAvatar) {
    window.location.href = "profiles.html";
    return;
  }

  const greetEl = document.getElementById("greet");
  if (greetEl) greetEl.textContent = `Hello, ${profileName}`;
  const avatarEl = document.getElementById("navAvatar");
  if (avatarEl) { avatarEl.src = profileAvatar; avatarEl.alt = `${profileName} - Profile`; }

  const logoutLink = document.getElementById("logoutLink");
  if (logoutLink) {
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await fetch(`${API_BASE}/logout`, { method: "POST" }); } catch {}
      ["selectedProfileId","selectedProfileName","selectedProfileAvatar"].forEach(k => localStorage.removeItem(k));
      window.location.href = "login.html";
    });
  }

  // ===== 2) Local state
  let CURRENT_ITEMS = []; // last loaded list (feed or search)
  const progressKey = `progress_by_${selectedId}`;
  const progress = JSON.parse(localStorage.getItem(progressKey) || "{}");

  // ===== 3) API helpers
  async function apiGet(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
  }
  async function apiPost(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `POST ${url} -> ${res.status}`;
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  // FIX: Always pass profileId for proper like annotations
  async function loadFeed({ profileId, sort = "popular", limit = 30 } = {}) {
    const qs = new URLSearchParams({ 
      profileId: String(profileId || selectedId), 
      sort, 
      limit: String(limit) 
    });
    const data = await apiGet(`${API_BASE}/feed?${qs.toString()}`);
    return data.items || [];
  }

  // FIX: Always pass profileId for proper like annotations
  async function searchContent({ profileId, query, type = "", genre = "", year_from = "", year_to = "", sort = "popular", limit = 50 }) {
    const qs = new URLSearchParams({
      profileId: String(profileId || selectedId),
      query: String(query || ""),
      type: String(type || ""),
      genre: String(genre || ""),
      year_from: String(year_from || ""),
      year_to: String(year_to || ""),
      sort, 
      limit: String(limit),
    });
    const data = await apiGet(`${API_BASE}/search?${qs.toString()}`);
    return data.items || [];
  }

  async function loadRecommendations({ profileId, limit = 20 } = {}) {
    const qs = new URLSearchParams({ 
      profileId: String(profileId || selectedId), 
      limit: String(limit) 
    });
    const data = await apiGet(`${API_BASE}/recommendations?${qs.toString()}`);
    return data.items || [];
  }

  async function toggleLike({ profileId, contentExtId, like }) {
    return apiPost(`${API_BASE}/likes/toggle`, { 
      profileId: String(profileId), 
      contentExtId: String(contentExtId), 
      like: !!like 
    });
  }

  // ===== 3b) UI Alerts
  function ensureAlertRoot() {
    let root = document.getElementById('nf-alert-root');
    if (!root) { 
      root = document.createElement('div'); 
      root.id = 'nf-alert-root'; 
      root.className = 'nf-alert-root'; 
      document.body.appendChild(root); 
    }
    return root;
  }
  
  function showAlert({ type = 'error', title = 'Something went wrong', message = '', details = '', actions = [] } = {}) {
    const root = ensureAlertRoot();
    const el = document.createElement('div');
    el.className = `nf-alert nf-alert--${type}`;
    el.innerHTML = `
      ${title ? `<div class="nf-alert__title">${title}</div>` : ""}
      ${message ? `<div class="nf-alert__message">${message}</div>` : ""}
      ${details ? `<pre class="nf-alert__details"></pre>` : ""}
      <div class="nf-alert__actions"></div>
    `;
    if (details) el.querySelector('.nf-alert__details').textContent = details;
    const actionsBox = el.querySelector('.nf-alert__actions');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'nf-alert__btn'; 
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => el.remove());
    actionsBox.appendChild(closeBtn);
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'nf-alert__btn'; 
      b.textContent = a?.label || 'OK';
      b.addEventListener('click', () => { 
        try { a?.handler && a.handler(); } 
        finally { el.remove(); } 
      });
      actionsBox.appendChild(b);
    });
    root.appendChild(el);
    setTimeout(() => el.classList.add('is-shown'), 10);
    if (type !== 'error') setTimeout(() => el.remove(), 12000);
  }

  // ===== 4) Rendering
  function createCard(item, withProgress = false) {
    const pid = String(item.extId || item.id);
    const prog = progress[pid] || 0;

    const card = document.createElement("article");
    card.className = "nf-card";
    card.dataset.extId = pid;

    const count = Number(item.likes || 0);
    const liked = !!item.liked;

    card.innerHTML = `
      <div class="nf-card__cover">
        <img src="${item.cover || ''}" alt="${item.title || ''}" loading="lazy"
             onerror="this.onerror=null;this.style.display='none';" />
        ${withProgress ? `<div class="nf-progress"><div class="nf-progress__bar" style="width:${prog}%"></div></div>` : ``}
      </div>
      <div class="nf-card__meta">
        <div class="nf-card__title" title="${item.title || ''}">${item.title || ''}</div>
        <div class="nf-card__sub">${[item.year, item.type].filter(Boolean).join(" • ")}</div>
        <button class="btn btn-sm rounded-pill like-btn ${liked ? "liked" : ""}" type="button"
                aria-pressed="${liked}" aria-label="${liked ? "Unlike" : "Like"} ${item.title || ''}">
          <span class="heart" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" role="img">
              <path d="M12 21s-6.716-4.555-9.193-7.032C.977 12.139.5 10.96.5 9.708.5 6.817 2.817 4.5 5.708 4.5c1.522 0 2.974.62 4.042 1.688L12 8.439l2.25-2.25A5.726 5.726 0 0 1 18.292 4.5c2.891 0 5.208 2.317 5.208 5.208 0 1.252-.477 2.431-2.307 4.26C18.716 16.445 12 21 12 21z"></path>
            </svg>
          </span>
          <span class="like-count">${count}</span>
        </button>
      </div>
    `;
    return card;
  }

  function setBtnDisabled(btn, isDisabled) {
    btn.disabled = isDisabled;
    btn.setAttribute("aria-disabled", String(isDisabled));
    btn.classList.toggle("is-disabled", !!isDisabled);
  }
  
  function updateArrowStates(scroller, leftArrow, rightArrow) {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const x = scroller.scrollLeft;
    setBtnDisabled(leftArrow,  x <= 5);
    setBtnDisabled(rightArrow, x >= (maxScroll - 5));
  }

  function makeRow({ id, title, items, withProgress = false }) {
    const section = document.createElement("section");
    section.className = "nf-row";
    section.innerHTML = `
      <h2 class="nf-row__title">${title}</h2>
      <div class="nf-row__viewport">
        <button type="button" class="btn nf-row__arrow nf-row__arrow--left" aria-label="Scroll left" disabled>
          <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="nf-row__scroller" id="${id}"></div>
        <button type="button" class="btn nf-row__arrow nf-row__arrow--right" aria-label="Scroll right">
          <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    `;
    const scroller = section.querySelector(".nf-row__scroller");
    items.forEach(item => scroller.appendChild(createCard(item, withProgress)));

    const left = section.querySelector(".nf-row__arrow--left");
    const right = section.querySelector(".nf-row__arrow--right");
    const scrollAmount = () => scroller.clientWidth;

    requestAnimationFrame(() => updateArrowStates(scroller, left, right));

    let t;
    scroller.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => updateArrowStates(scroller, left, right), 50);
    });

    left.addEventListener("click", (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (!left.disabled) {
        scroller.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
        setTimeout(() => updateArrowStates(scroller, left, right), 350);
      }
    });
    
    right.addEventListener("click", (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (!right.disabled) {
        scroller.scrollBy({ left: scrollAmount(), behavior: "smooth" });
        setTimeout(() => updateArrowStates(scroller, left, right), 350);
      }
    });

    return section;
  }

  function refreshAllArrows() {
    document.querySelectorAll(".nf-row").forEach(row => {
      const scroller = row.querySelector(".nf-row__scroller");
      const left = row.querySelector(".nf-row__arrow--left");
      const right = row.querySelector(".nf-row__arrow--right");
      if (scroller && left && right) updateArrowStates(scroller, left, right);
    });
  }

  function mostLiked(items) {
    if (!items?.length) return null;
    return items.reduce((best, cur) => 
      (Number(cur.likes || 0) > Number(best.likes || 0)) ? cur : best, 
      items[0]
    );
  }
  
  function displayFeatured(items) {
    const hero = document.getElementById("hero");
    if (!hero || !items?.length) return;
    const featured = mostLiked(items) || items[0];
    const heroImg = featured.backdrop || featured.cover || '';
    hero.innerHTML = `
      <div class="nf-hero__bg" style="background-image:url('${heroImg}')"></div>
      <div class="nf-hero__meta" dir="rtl">
        <h1 class="nf-hero__title">${featured.title}</h1>
        <div class="nf-hero__sub">${[featured.year, (featured.genres||[]).join(" • "), featured.type].filter(Boolean).join(" • ")}</div>
        <div class="nf-hero__actions">
          <button class="nf-cta nf-cta--play" id="btnPlay" type="button" aria-label="Play">
            <svg viewBox="0 0 24 24" class="nf-cta__icon" aria-hidden="true"><path d="M6 4l14 8-14 8z"></path></svg>
            <span>Play</span>
          </button>
          <button class="nf-cta nf-cta--info" id="btnInfo" type="button" aria-haspopup="dialog" aria-controls="infoDialog" aria-label="More Info">
            <svg viewBox="0 0 24 24" width="24" height="24" class="nf-cta__icon" aria-hidden="true" fill="none" role="img">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 8v8h-2v-8h2Zm-1-1.5A1.5 1.5 0 1 0 12 6a1.5 1.5 0 0 0 0 3Z" fill="currentColor"></path>
            </svg>
            <span>More Info</span>
          </button>
        </div>
      </div>
    `;
  }

  // ===== 5) Build rows (default/search/recommend)
  const rowsRoot = document.getElementById("rows");

  async function displayDefaultRows(sortMode = "popular") {
    if (!rowsRoot) return;
    rowsRoot.innerHTML = "";

    try {
      const [popular, sciFi, drama, classics, recs] = await Promise.all([
        loadFeed({ profileId: selectedId, sort: sortMode, limit: 16 }),
        searchContent({ profileId: selectedId, genre: "sci-fi", sort: sortMode, limit: 16 }),
        searchContent({ profileId: selectedId, genre: "drama",  sort: sortMode, limit: 16 }),
        searchContent({ profileId: selectedId, year_to: "1999", sort: sortMode, limit: 12 }),
        loadRecommendations({ profileId: selectedId, limit: 16 }),
      ]);

      CURRENT_ITEMS = popular.slice();
      displayFeatured(CURRENT_ITEMS);

      const rows = [
        { id: "row-recs",     title: `Recommended for you`, items: recs || [] },
        { id: "row-popular",  title: sortMode === "alpha" ? "A–Z Catalog" : "Popular on Netflix", items: popular || [] },
        { id: "row-sci",      title: sortMode === "alpha" ? "Sci-Fi & Fantasy (A–Z)" : "Sci-Fi & Fantasy", items: sciFi || [] },
        { id: "row-drama",    title: sortMode === "alpha" ? "Drama (A–Z)" : "Critically-acclaimed Drama", items: drama || [] },
        { id: "row-classic",  title: sortMode === "alpha" ? "Classics (A–Z)" : "Classics", items: classics || [] },
      ];
      
      rows.forEach(r => { 
        if (r.items?.length) rowsRoot.appendChild(makeRow(r)); 
      });
      
      refreshAllArrows();
    } catch (err) {
      console.error('Error loading default rows:', err);
      showAlert({ 
        type: 'error', 
        title: 'Loading Error', 
        message: 'Failed to load content. Please refresh the page.' 
      });
    }
  }

  function displaySearchResults(results, query) {
    if (!rowsRoot) return;
    rowsRoot.innerHTML = "";
    
    if (!results?.length) {
      rowsRoot.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">No results for "${query}"</div>`;
      return;
    }
    
    CURRENT_ITEMS = results.slice();
    const row = { 
      id: "row-search", 
      title: `Search Results for "${query}" (${results.length})`, 
      items: results 
    };
    rowsRoot.appendChild(makeRow(row));
    refreshAllArrows();
  }

  // ===== 6) Likes (delegation)
  if (rowsRoot) {
    rowsRoot.addEventListener("click", async (e) => {
      const btn = e.target.closest(".like-btn");
      if (!btn) return;
      e.preventDefault(); 
      e.stopPropagation();
      if (btn.dataset.busy === "1") return;

      const card = btn.closest(".nf-card");
      if (!card) return;
      const extId = String(card.dataset.extId || "");
      if (!extId) return;

      // optimistic UI
      const countEl = btn.querySelector(".like-count");
      const wasLiked = btn.classList.contains("liked");
      const goingLiked = !wasLiked;
      btn.classList.toggle("liked", goingLiked);
      btn.setAttribute("aria-pressed", String(goingLiked));
      const prev = Number(countEl?.textContent || "0") || 0;
      const optimistic = Math.max(0, prev + (goingLiked ? 1 : -1));
      if (countEl) countEl.textContent = String(optimistic);

      btn.dataset.busy = "1";
      btn.setAttribute("aria-busy", "true");
      
      try {
        const { liked, likes } = await toggleLike({ 
          profileId: selectedId, 
          contentExtId: extId, 
          like: goingLiked 
        });
        
        btn.classList.toggle("liked", !!liked);
        btn.setAttribute("aria-pressed", String(!!liked));
        if (countEl) countEl.textContent = String(Math.max(0, Number(likes || 0)));
        
        // sync local CURRENT_ITEMS
        const i = CURRENT_ITEMS.findIndex(x => String(x.extId || x.id) === extId);
        if (i !== -1) { 
          CURRENT_ITEMS[i].liked = !!liked; 
          CURRENT_ITEMS[i].likes = Number(likes || 0); 
        }
      } catch (err) {
        // rollback
        btn.classList.toggle("liked", wasLiked);
        btn.setAttribute("aria-pressed", String(wasLiked));
        if (countEl) countEl.textContent = String(prev);
        showAlert({ 
          type: 'error', 
          title: 'Like failed', 
          message: err?.message || 'Error while updating like' 
        });
      } finally {
        delete btn.dataset.busy;
        btn.removeAttribute("aria-busy");
      }
    }, false);
  }

  // ===== 7) Search UI + behavior
  const searchInput = document.getElementById("searchInput");
  const searchBox   = document.getElementById("searchBox");
  const searchBtn   = document.getElementById("searchBtn");
  const alphaToggle = document.getElementById("alphaToggle");
  const SORT_KEY    = "nf_sort_mode";
  let lastSort      = (localStorage.getItem(SORT_KEY) === "alpha") ? "alpha" : "popular";
  if (alphaToggle) alphaToggle.checked = (lastSort === "alpha");

  function setSort(mode) {
    lastSort = mode;
    localStorage.setItem(SORT_KEY, lastSort);
    if (alphaToggle && alphaToggle.checked !== (mode === "alpha")) {
      alphaToggle.checked = (mode === "alpha");
    }
    
    const q = (searchInput?.value || "").trim();
    if (q) {
      searchContent({ 
        profileId: selectedId, 
        query: q, 
        sort: lastSort, 
        limit: 50 
      })
        .then(results => displaySearchResults(results, q))
        .catch(err => {
          console.error('Search error:', err);
          showAlert({ 
            type: 'error', 
            title: 'Search failed', 
            message: err?.message || 'Error while searching' 
          });
        });
    } else {
      displayDefaultRows(lastSort);
    }
  }

  if (alphaToggle) {
    const onAlpha = (e) => { 
      e.stopPropagation(); 
      setSort(alphaToggle.checked ? "alpha" : "popular"); 
    };
    alphaToggle.addEventListener("input", onAlpha, true);
    alphaToggle.addEventListener("change", onAlpha, true);
    alphaToggle.addEventListener("click", (e) => { e.stopPropagation(); }, true);
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!searchBox) return;
      searchBox.classList.toggle("is-open");
      searchBox.setAttribute("aria-expanded", String(searchBox.classList.contains("is-open")));
      if (searchBox.classList.contains("is-open") && searchInput) { 
        searchInput.focus(); 
      } else {
        // closing: if empty, restore default rows
        if (!searchInput || !searchInput.value.trim()) {
          displayDefaultRows(lastSort);
        }
      }
    });
  }

  let searchTimeout;
  async function performSearch(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const q = (query || "").trim();
      if (!q) { 
        await displayDefaultRows(lastSort); 
        return; 
      }
      try {
        const results = await searchContent({ 
          profileId: selectedId, 
          query: q, 
          sort: lastSort, 
          limit: 50 
        });
        displaySearchResults(results, q);
      } catch (err) { 
        console.error("Search error:", err); 
        showAlert({ 
          type: 'error', 
          title: 'Search failed', 
          message: err?.message || 'Error while searching' 
        });
      }
    }, 300);
  }
  
  if (searchInput) {
    searchInput.addEventListener("input", (e) => performSearch(e.target.value));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (searchBox) { 
        searchBox.classList.remove("is-open"); 
        searchBox.setAttribute("aria-expanded","false"); 
      }
      if (searchInput) { 
        searchInput.value = ""; 
        searchInput.blur(); 
      }
      displayDefaultRows(lastSort);
    }
  });
  
  document.addEventListener("click", (e) => {
    if (!searchBox) return;
    const within = searchBox.contains(e.target);
    if (!within && searchBox.classList.contains("is-open")) {
      if (!searchInput || !searchInput.value.trim()) {
        searchBox.classList.remove("is-open");
        searchBox.setAttribute("aria-expanded","false");
        displayDefaultRows(lastSort);
      }
    }
  });

  // ===== 8) Disabled arrows guard
  function isPointInsideDisabledArrow(clientX, clientY) {
    const disabledArrows = document.querySelectorAll('.nf-row__arrow[disabled], .nf-row__arrow.is-disabled, .nf-row__arrow[aria-disabled="true"]');
    for (const el of disabledArrows) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return true;
      }
    }
    return false;
  }
  
  function blockIfInsideDisabledArrow(e) {
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? e.changedTouches?.[0]?.clientX;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY;
    if (x == null || y == null) return;
    if (isPointInsideDisabledArrow(x, y)) {
      e.preventDefault(); 
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
    }
  }
  
  document.addEventListener("click",       blockIfInsideDisabledArrow, true);
  document.addEventListener("pointerdown", blockIfInsideDisabledArrow, true);
  document.addEventListener("touchstart",  blockIfInsideDisabledArrow, { capture: true, passive: false });

  window.addEventListener("resize", refreshAllArrows);

  // ===== 9) Init
  // seed some "continue watching" progress locally (demo only)
  try {
    if (!Object.keys(progress).length) {
      const warm = await loadFeed({ profileId: selectedId, sort: "popular", limit: 8 });
      warm.forEach(i => {
        progress[String(i.extId)] = Math.floor(Math.random() * 80) + 10;
      });
      localStorage.setItem(progressKey, JSON.stringify(progress));
    }
  } catch (err) {
    console.error('Error seeding progress:', err);
  }

  // initial render
  await displayDefaultRows(lastSort);
});