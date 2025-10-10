// JS/feed.js
document.addEventListener("DOMContentLoaded", async () => {
document.addEventListener('click', (e) => {
  const allow = e.target.closest('#alphaToggle, label[for="alphaToggle"], .sort-toggle, [data-allow-default], .allow-default, button, input, select, textarea');
  if (allow) return;

  const a = e.target.closest('a');
  if (!a) return;
  if (a.id === 'logoutLink') return;

  const href = (a.getAttribute('href') || '').trim().toLowerCase();
  const isDead = href === '' || href === '#' || href === 'javascript:void(0)';

  if (isDead) {
    e.preventDefault();
  }
}, true);


  // =========================
  // 1) Session / Navbar
  // =========================
  const API_BASE = "http://localhost:3000/api";

  const selectedIdStr = localStorage.getItem("selectedProfileId");
  const selectedId = selectedIdStr ? Number(selectedIdStr) : NaN;
  const profileName = localStorage.getItem("selectedProfileName");
  const profileAvatar = localStorage.getItem("selectedProfileAvatar");

  if (!selectedId || Number.isNaN(selectedId) || !profileName || !profileAvatar) {
    window.location.href = "profiles.html";
    return;
  }

  const greetEl = document.getElementById("greet");
  if (greetEl) greetEl.textContent = `Hello, ${profileName}`;

  const avatarEl = document.getElementById("navAvatar");
  if (avatarEl) {
    avatarEl.src = profileAvatar;
    avatarEl.alt = `${profileName} - Profile`;
  }

  const logoutLink = document.getElementById("logoutLink");
  if (logoutLink) {
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try { await fetch(`${API_BASE}/logout`, { method: "POST" }); } catch {}
      try {
        localStorage.removeItem("selectedProfileId");
        localStorage.removeItem("selectedProfileName");
        localStorage.removeItem("selectedProfileAvatar");
      } catch {}
      window.location.href = "login.html";
    });
  }

  // =========================
  // 2) Local state
  // =========================
  let CATALOG = [];
  let likedIds = new Set();

  const progressKey = `progress_by_${selectedId}`;
  const progress = JSON.parse(localStorage.getItem(progressKey) || "{}");

  // =========================
  // 3) API helpers
  // =========================
  async function fetchContent(params = {}) {
    try {
      const queryParams = new URLSearchParams();
      if (params.q) queryParams.append("q", params.q);
      if (params.genre) queryParams.append("genre", params.genre);
      if (params.type) queryParams.append("type", params.type);
      if (params.year_from) queryParams.append("year_from", params.year_from);
      if (params.year_to) queryParams.append("year_to", params.year_to);
      // אם השרת לא תומך ב-sort=alpha, לא חובה לשלוח אותו; נשאיר רק כדי שלא ישבור במידה וכן.
      if (params.sort && params.sort !== "alpha") queryParams.append("sort", params.sort);
      if (params.limit) queryParams.append("limit", params.limit);

      const url = `${API_BASE}/search?${queryParams.toString()}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data.results) ? data.results : [];
    } catch (err) {
      console.error("Error fetching content:", err);
      return CATALOG;
    }
  }

  async function loadLikedState() {
    try {
      const params = new URLSearchParams();
      params.set("profileId", String(selectedId));
      const res = await fetch(`${API_BASE}/content?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const all = await res.json();
      likedIds = new Set(all.filter(x => x.liked).map(x => String(x.id)));
    } catch (e) {
      console.warn("Failed to load liked state; defaulting to none.", e);
      likedIds = new Set();
    }
  }

  async function toggleLike(contentId, like) {
    const res = await fetch(`${API_BASE}/likes/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: selectedId, contentId, like }),
    });
    if (!res.ok) {
      let msg = "Failed to update like";
      try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json(); // { liked, likes }
  }

  // =========================
  // 3b) UI Alerts (non-blocking)
  // =========================
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
        try { a?.handler && a.handler(); } finally { el.remove(); }
      });
      actionsBox.appendChild(b);
    });

    root.appendChild(el);
    setTimeout(() => el.classList.add('is-shown'), 10);
    if (type !== 'error') setTimeout(() => el.remove(), 12000);
  }

  function showFetchError(context, errSummary, raw) {
    showAlert({
      type: 'error',
      title: "Can't load content",
      message: context || "We couldn't load the catalog from the server.",
      details: (errSummary ? errSummary + '\n\n' : '') + (raw || ''),
      actions: [{ label: 'Retry', handler: () => window.location.reload() }]
    });
  }

  // =========================
  // 3c) Catalog bootstrap with timeout & normalization
  // =========================
  async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000, ...opts } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(resource, { ...opts, signal: controller.signal });
      return res;
    } finally { clearTimeout(id); }
  }

  async function fetchCatalog() {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/content`, {
        headers: { 'Accept': 'application/json' },
        timeout: 8000
      });

      if (res.status === 401 || res.status === 403) {
        showAlert({
          type: 'error',
          title: 'Session expired',
          message: 'Please sign in again to see your catalog.',
          actions: [{ label: 'Go to login', handler: () => (window.location.href = 'login.html') }]
        });
        return [];
      }
      if (res.status >= 500) {
        showFetchError('The server is temporarily unavailable.', 'Try again in a minute or contact support.', `HTTP ${res.status}`);
        return [];
      }
      if (!res.ok) {
        showFetchError("We couldn't load the catalog from the server.", 'Check that /api/content exists and returns valid JSON.', `HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      const norm =
        Array.isArray(data) ? data :
        (data && typeof data === 'object' && Array.isArray(data.items)) ? data.items :
        (data && typeof data === 'object' && Array.isArray(data.catalog)) ? data.catalog :
        (data && typeof data === 'object' && Array.isArray(data.data)) ? data.data :
        (data && typeof data === 'object' ? Object.values(data).filter(Array.isArray).flat() : []);

      if (!Array.isArray(norm) || norm.length === 0) {
        showFetchError('No titles are available right now.', 'Ensure content.json exists next to server.js and contains items.', 'API returned an empty array');
        return [];
      }

      return norm.map(it => {
        const title = it.title || it.name || 'Untitled';
        const genres = Array.isArray(it.genres) ? it.genres :
                       Array.isArray(it.genre) ? it.genre :
                       (typeof it.genre === 'string' ? it.genre.split(',').map(s => s.trim()).filter(Boolean) : []);
        const type = it.type || (it.seasons ? 'Series' : 'Movie');
        return {
          id: String(it.id ?? title),
          title,
          year: it.year ?? it.releaseYear ?? '',
          genres,
          likes: Number.isFinite(it.likes) ? Number(it.likes) : 0,
          cover: it.cover || it.poster || it.image || it.img || '',
          backdrop: it.backdrop || it.background || '',
          type
        };
      });
    } catch (e) {
      const msg = (e?.name === 'AbortError') ? 'The request took too long and was canceled.' : (e?.message || String(e));
      showFetchError("We couldn't load the catalog.", 'Troubleshooting tips:\n• Check your internet\n• Ensure the server is running\n• Verify /api/content returns valid JSON', msg);
      return [];
    }
  }

  // Bootstrap catalog early for empty-state
  CATALOG = await fetchCatalog();

  if (!Array.isArray(CATALOG) || CATALOG.length === 0) {
    const rows = document.getElementById('rows');
    if (rows) {
      rows.innerHTML = `
        <div class="nf-empty">
          <div class="nf-empty__icon">🌀</div>
          <h2 class="nf-empty__title">No titles (yet)</h2>
          <p class="nf-empty__text">We couldn't load the catalog. Try again in a moment.</p>
          <button class="btn nf-empty__btn" type="button" onclick="location.reload()">Retry</button>
        </div>`;
    }
    return;
  }

  // =========================
  // 4) Rendering & Sorting helpers
  // =========================
  function likeEntryFor(item) {
    const liked = likedIds.has(String(item.id));
    const count = Number(item.likes || 0);
    return { liked, count };
  }

  function normalizeTitle(t) {
    return String(t || "").trim().toLocaleLowerCase();
  }

  function applySort(items, mode) {
    if (!Array.isArray(items)) return [];
    if (mode !== "alpha") return items;
    // מיון אלפביתי בצד הלקוח — גם אם השרת מתעלם
    return [...items].sort((a, b) =>
      normalizeTitle(a.title).localeCompare(normalizeTitle(b.title), undefined, { sensitivity: "base" })
    );
  }

  function createCard(item, withProgress = false) {
    const pid = String(item.id);
    const p = progress[pid] || 0;
    const entry = likeEntryFor(item);

    const card = document.createElement("article");
    card.className = "nf-card";
    card.dataset.title = item.title.toLowerCase();
    card.dataset.itemId = pid;

    card.innerHTML = `
      <div class="nf-card__cover">
        <img src="${item.cover}" alt="${item.title}" loading="lazy"
             onerror="this.onerror=null;this.style.display='none';" />
        ${withProgress ? `<div class="nf-progress"><div class="nf-progress__bar" style="width:${p}%"></div></div>` : ``}
      </div>
      <div class="nf-card__meta">
        <div class="nf-card__title" title="${item.title}">${item.title}</div>
        <div class="nf-card__sub">${item.year} • ${item.type}</div>
        <button class="btn btn-sm rounded-pill like-btn ${entry.liked ? "liked" : ""}"
                type="button" aria-pressed="${entry.liked}" aria-label="${entry.liked ? "Unlike" : "Like"} ${item.title}">
          <span class="heart" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" role="img">
              <path d="M12 21s-6.716-4.555-9.193-7.032C.977 12.139.5 10.96.5 9.708.5 6.817 2.817 4.5 5.708 4.5c1.522 0 2.974.62 4.042 1.688L12 8.439l2.25-2.25A5.726 5.726 0 0 1 18.292 4.5c2.891 0 5.208 2.317 5.208 5.208 0 1.252-.477 2.431-2.307 4.26C18.716 16.445 12 21 12 21z"></path>
            </svg>
          </span>
          <span class="like-count">${entry.count}</span>
        </button>
      </div>
    `;
    return card;
  }

  function setBtnDisabled(btn, isDisabled) {
    btn.disabled = isDisabled;
    btn.setAttribute("aria-disabled", String(isDisabled));
    if (isDisabled) {
      btn.classList.add("is-disabled");
      btn.tabIndex = -1;
    } else {
      btn.classList.remove("is-disabled");
      btn.removeAttribute("tabindex");
    }
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

    let scrollTimeout;
    scroller.addEventListener("scroll", () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => updateArrowStates(scroller, left, right), 50);
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
        scroller.scrollBy({ left:  scrollAmount(), behavior: "smooth" });
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
    if (!items.length) return null;
    return items.reduce((best, cur) => (Number(cur.likes || 0) > Number(best.likes || 0)) ? cur : best, items[0]);
  }

  function displayFeatured() {
    const hero = document.getElementById("hero");
    if (!hero || !CATALOG.length) return;
    const featured = mostLiked(CATALOG) || CATALOG[0];
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

  // =========================
  // 5) Rows (Default + Search)
  // =========================
  async function displayDefaultRows(sortMode = "popular") {
    const rowsRoot = document.getElementById("rows");
    if (!rowsRoot) return;

    rowsRoot.innerHTML = "";

    const [list1, sciFi, drama, classics] = await Promise.all([
      fetchContent({ sort: sortMode, limit: 14 }),
      fetchContent({ genre: "sci-fi", sort: sortMode, limit: 14 }),
      fetchContent({ genre: "drama",  sort: sortMode, limit: 14 }),
      fetchContent({ year_to: 1999,   sort: sortMode, limit: 12 }),
    ]);

    // ✅ תמיד מוודאים מיון לקוחותי כשצריך
    const r1 = applySort(list1,   sortMode);
    const r2 = applySort(sciFi,   sortMode);
    const r3 = applySort(drama,   sortMode);
    const r4 = applySort(classics,sortMode);

    const continueWatching = applySort(
      CATALOG.filter(i => (progress[String(i.id)] ?? 0) > 0).slice(0, 12),
      sortMode
    );

    const rows = [
      { id: "row-popular",   title: sortMode === "alpha" ? "A-Z Catalog" : "Popular on Netflix", items: r1 },
      { id: "row-continue",  title: `Continue Watching for ${profileName}`, items: continueWatching, withProgress: true },
      { id: "row-sci",       title: sortMode === "alpha" ? "Sci-Fi & Fantasy (A-Z)" : "Sci-Fi & Fantasy", items: r2 },
      { id: "row-drama",     title: sortMode === "alpha" ? "Drama (A-Z)" : "Critically-acclaimed Drama", items: r3 },
      { id: "row-classic",   title: sortMode === "alpha" ? "Classics (A-Z)" : "Classics", items: r4 },
    ];

    rows.forEach(r => { if (r.items && r.items.length) rowsRoot.appendChild(makeRow(r)); });
    refreshAllArrows();
  }

  function displaySearchResults(results, query, sortMode) {
    const rowsRoot = document.getElementById("rows");
    if (!rowsRoot) return;

    rowsRoot.innerHTML = "";

    const sorted = applySort(results, sortMode);

    if (!sorted.length) {
      rowsRoot.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">No results found for "${query}"</div>`;
      return;
    }

    const searchRow = { id: "row-search", title: `Search Results for "${query}" (${sorted.length})`, items: sorted };
    rowsRoot.appendChild(makeRow(searchRow));
    refreshAllArrows();
  }

  // =========================
  // 6) Likes (delegation + server)
  // =========================
  const rowsRoot = document.getElementById("rows");
  if (rowsRoot) {
    rowsRoot.addEventListener("click", async (e) => {
      const btn = e.target.closest(".like-btn");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.busy === "1") return;

      const card = btn.closest(".nf-card");
      if (!card) return;

      const pid = String(card.dataset.itemId);
      const item = CATALOG.find(i => String(i.id) === pid);
      if (!item) return;

      const isLiked = likedIds.has(pid);
      const goingLiked = !isLiked;

      // optimistic UI
      btn.classList.toggle("liked", goingLiked);
      btn.setAttribute("aria-pressed", String(goingLiked));
      const countEl = btn.querySelector(".like-count");
      const prevCount = Number(countEl?.textContent || "0") || 0;
      const optimistic = Math.max(0, prevCount + (goingLiked ? 1 : -1));
      if (countEl) countEl.textContent = optimistic;

      btn.classList.remove("anim-like", "anim-unlike");
      void btn.offsetWidth; // reset animation
      btn.classList.add(goingLiked ? "anim-like" : "anim-unlike");

      const cleanOnce = (ev) => {
        if (ev.target !== btn && !btn.contains(ev.target)) return;
        btn.classList.remove("anim-like", "anim-unlike");
        btn.removeEventListener("animationend", cleanOnce);
      };
      btn.addEventListener("animationend", cleanOnce, { once: true });

      btn.dataset.busy = "1";
      btn.setAttribute("aria-busy", "true");

      try {
        const resp = await toggleLike(pid, goingLiked); // { liked, likes }

        const serverLiked = !!resp?.liked;
        btn.classList.toggle("liked", serverLiked);
        btn.setAttribute("aria-pressed", String(serverLiked));
        if (serverLiked) likedIds.add(pid); else likedIds.delete(pid);

        if (typeof resp?.likes === "number") {
          if (countEl) countEl.textContent = String(Math.max(0, resp.likes));
          const idx = CATALOG.findIndex(i => String(i.id) === pid);
          if (idx !== -1) CATALOG[idx].likes = resp.likes;
        } else if (countEl) {
          const base = Number(countEl.textContent || "0") || 0;
          const delta = (serverLiked === goingLiked) ? 0 : (serverLiked ? +1 : -1);
          countEl.textContent = String(Math.max(0, base + delta));
        }
      } catch (err) {
        console.error(err);
        // rollback
        btn.classList.toggle("liked", isLiked);
        btn.setAttribute("aria-pressed", String(isLiked));
        if (countEl) countEl.textContent = String(prevCount);

        btn.classList.remove("anim-like", "anim-unlike");
        void btn.offsetWidth;
        btn.classList.add(isLiked ? "anim-like" : "anim-unlike");

        showAlert({ type: 'error', title: 'Like failed', message: err?.message || 'Error while updating like' });
      } finally {
        delete btn.dataset.busy;
        btn.removeAttribute("aria-busy");
      }
    }, false);
  }

  // =========================
// 7) Search UI + behavior
// =========================
const searchInput   = document.getElementById("searchInput");
const searchBox     = document.getElementById("searchBox");
const searchBtn     = document.getElementById("searchBtn");
const alphaToggle   = document.getElementById("alphaToggle");
let searchTimeout;

const SORT_KEY = "nf_sort_mode";
let lastSort = (localStorage.getItem(SORT_KEY) === "alpha") ? "alpha" : "popular";

function setSort(mode, { rerender = true } = {}) {
  lastSort = mode;
  localStorage.setItem(SORT_KEY, lastSort);

  if (alphaToggle && alphaToggle.checked !== (lastSort === "alpha")) {
    alphaToggle.checked = (lastSort === "alpha");
  }

  if (!rerender) return;

  const q = (searchInput?.value || "").trim();
  if (q) {
    fetchContent({ q, sort: lastSort, limit: 50 })
      .then(results => displaySearchResults(results, q, lastSort))
      .catch(console.error);
  } else {
    displayDefaultRows(lastSort);
  }
}

if (alphaToggle) alphaToggle.checked = (lastSort === "alpha");

function openSearch() {
  if (!searchBox) return;
  searchBox.classList.add("is-open");
  searchBox.setAttribute("aria-expanded", "true");
  if (searchInput) {
    searchInput.focus();
    const val = searchInput.value;
    searchInput.value = "";
    searchInput.value = val;
  }
}

function closeSearch(force = false) {
  if (!searchBox) return;
  if (force || !searchInput || !searchInput.value.trim()) {
    searchBox.classList.remove("is-open");
    searchBox.setAttribute("aria-expanded", "false");
    if (!searchInput.value.trim()) {
      displayDefaultRows(lastSort);
    }
  }
}

if (searchBtn) {
  searchBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (searchBox.classList.contains("is-open")) closeSearch();
    else openSearch();
  });
}

async function performSearch(query) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const q = (query || "").trim();
    if (!q) { await displayDefaultRows(lastSort); return; }
    try {
      const results = await fetchContent({ q, sort: lastSort, limit: 50 });
      displaySearchResults(results, q, lastSort);
    } catch (err) { console.error("Search error:", err); }
  }, 300);
}

if (searchInput) {
  searchInput.addEventListener("input", (e) => performSearch(e.target.value));
}

if (alphaToggle) {
  const onAlpha = (e) => {
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

    const mode = alphaToggle.checked ? "alpha" : "popular";
    setSort(mode, { rerender: true });
  };

  alphaToggle.addEventListener("input", onAlpha, true);
  alphaToggle.addEventListener("change", onAlpha, true);

  alphaToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }, true);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSearch(true);
    if (searchInput) {
      searchInput.value = "";
      searchInput.blur();
      displayDefaultRows(lastSort);
    }
  }
});

document.addEventListener("click", (e) => {
  if (!searchBox) return;
  const within = searchBox.contains(e.target);
  if (!within) closeSearch();
});

  // =========================
  // 8) Disabled arrows hardening (no refresh!)
  // =========================
  function isArrowDisabled(btn) {
    return !!(btn && (btn.disabled ||
                      btn.classList.contains("is-disabled") ||
                      btn.getAttribute("aria-disabled") === "true"));
  }

  function isPointInsideDisabledArrow(clientX, clientY) {
    const disabledArrows = document.querySelectorAll(
      '.nf-row__arrow[disabled], .nf-row__arrow.is-disabled, .nf-row__arrow[aria-disabled="true"]'
    );
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
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    }
  }

  document.addEventListener("click",       blockIfInsideDisabledArrow, true);
  document.addEventListener("pointerdown", blockIfInsideDisabledArrow, true);
  document.addEventListener("touchstart",  blockIfInsideDisabledArrow, { capture: true, passive: false });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const btn = e.target?.closest?.(".nf-row__arrow");
    if (btn && isArrowDisabled(btn)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    }
  }, true);

  // =========================
  // 9) Global
  // =========================
  window.addEventListener("resize", refreshAllArrows);

  // Init
  (async () => {
    await loadLikedState();

    const content = await fetchContent({ limit: 200, sort: lastSort });
    if (Array.isArray(content) && content.length) CATALOG = applySort(content, lastSort);

    if (!Object.keys(progress).length && CATALOG.length) {
      CATALOG.slice(0, 8).forEach(i => (progress[String(i.id)] = Math.floor(Math.random() * 80) + 10));
      localStorage.setItem(progressKey, JSON.stringify(progress));
    }

    displayFeatured();
    await displayDefaultRows(lastSort);
  })();
});
