// JS/feed.js 

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
  const API_BASE = `${window.location.origin.replace(/\/$/, '')}/api`; // Use the current host so mobile devices hitting the LAN server don't call their own localhost.

  let selectedIdStr   = localStorage.getItem("selectedProfileId");
  let selectedId      = selectedIdStr ? String(selectedIdStr) : "";
  let profileName     = localStorage.getItem("selectedProfileName");
  let profileAvatar   = localStorage.getItem("selectedProfileAvatar");

  if (!selectedId || !profileName || !profileAvatar) {
    window.location.href = "profiles.html"; // Redirect visitors who have not selected a profile yet.
    return;
  }

  // Shared nav wiring (works even if header injected later)
  let profileMenuToggle;
  let profileMenu;
  let changeProfileBtn;
  let navWired = false;

  function setProfileMenu(open) {
    if (!profileMenu || !profileMenuToggle) return;
    const willOpen = !!open;
    profileMenu.hidden = !willOpen;
    profileMenuToggle.setAttribute("aria-expanded", String(willOpen));
    profileMenuToggle.classList.toggle("is-open", willOpen);
  }

  function toggleProfileMenu() {
    if (!profileMenu) return;
    setProfileMenu(profileMenu.hidden);
  }

  function wireNavOnce() {
    if (navWired) return;
    const header = document.querySelector('header.nf-nav');
    if (!header) return;

    // Greet + avatar
    const greetEl = document.getElementById("greet");
    if (greetEl) greetEl.textContent = `Hello, ${profileName}`; // Personalize the greeting with the active profile.
    const avatarEl = document.getElementById("navAvatar");
    if (avatarEl) {
      avatarEl.classList.remove("d-none");
      avatarEl.src = profileAvatar; // Swap the avatar to the chosen profile picture.
      avatarEl.alt = `${profileName} - Profile`; // Keep alt text accurate for accessibility.
    }
    const crownEl = document.getElementById("navAvatarCrown");
    if (crownEl) crownEl.classList.add("d-none"); // Hide the admin crown because only end-users load this page.

    // Logout
    const logoutLink = document.getElementById("logoutLink");
    if (logoutLink && !logoutLink.dataset.wired) { // Only bind the handler once per page load.
      logoutLink.dataset.wired = '1'; // Flag the element so we don't double-bind.
      logoutLink.addEventListener("click", async (e) => {
        e.preventDefault(); // Prevent the anchor from navigating before we log out.
        try {
          await fetch(`${API_BASE}/logout`, { method: "POST" }); // Ask the server to tear down the session cookie.
        } catch (err) {
          console.warn("Logout failed:", err); // Log (but don't surface) network hiccups so logout still clears local state.
        }
        localStorage.clear(); // Drop all persisted client data (profiles, user markers, etc.).
        sessionStorage.clear(); // Mirror the cleanup for session storage to avoid stale data.
        window.location.replace("login.html"); // Redirect cleanly to login so the user can sign in again.
      });
    }

    // Profile menu
    profileMenuToggle = document.getElementById("profileMenuToggle");
    profileMenu = document.getElementById("profileMenu");
    changeProfileBtn = document.getElementById("changeProfileBtn");

    if (profileMenuToggle && profileMenu && !profileMenuToggle.dataset.wired) {
      profileMenuToggle.dataset.wired = '1';
      profileMenuToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleProfileMenu();
      });
    }

    if (changeProfileBtn && !changeProfileBtn.dataset.wired) {
      changeProfileBtn.dataset.wired = '1'; // Ensure the handler only binds once.
      changeProfileBtn.textContent = 'Change Profile'; // Present the user profile switcher label.
      changeProfileBtn.addEventListener("click", () => {
        setProfileMenu(false); // Close the profile menu before navigating away.
        ["selectedProfileId","selectedProfileName","selectedProfileAvatar"].forEach(k => localStorage.removeItem(k)); // Clear the remembered profile so the user must pick again.
        window.location.href = "profiles.html"; // Send the viewer to the profile selection page.
      });
    }

    if (!document.body.dataset.navCloseWired) {
      document.body.dataset.navCloseWired = '1';
      document.addEventListener("click", (e) => {
        if (!profileMenu || !profileMenuToggle) return;
        if (profileMenu.hidden) return;
        const within = profileMenu.contains(e.target) || profileMenuToggle.contains(e.target);
        if (!within) setProfileMenu(false);
      });
    }

    navWired = true;
  }

  // Initial attempt
  wireNavOnce();
  // Watch for late-inserted header (e.g., title.html injects it)
  const mo = new MutationObserver(() => { if (!navWired) wireNavOnce(); });
  mo.observe(document.body, { childList: true, subtree: true });

  // ===== 2) Local state
  let CURRENT_ITEMS = []; // last loaded list (feed or search)
  const progressKey = `progress_by_${selectedId}`;
  const progress = JSON.parse(localStorage.getItem(progressKey) || "{}");
  const DEFAULT_SCROLL_STEP = 5;
  const LOOP_MIN_ITEMS = 6;
  let ROW_SCROLL_STEP = DEFAULT_SCROLL_STEP;
  const ROW_META = new WeakMap();

  try {
    const cfg = await loadConfig();
    const step = Number(cfg?.scrollStep);
    if (Number.isFinite(step) && step > 0) {
      ROW_SCROLL_STEP = step;
    }
  } catch (err) {
    console.warn("Falling back to default row scroll step:", err);
  }

  // ===== 3) API helpers
  function normalizePath(p) {
    const s = String(p || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return s.startsWith('/') ? s : ('/' + s);
  }
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

  async function loadConfig() {
    try {
      const data = await apiGet(`${API_BASE}/config`);
      return data || {};
    } catch (err) {
      console.warn("Failed to load config:", err);
      return {};
    }
  }

  async function loadFeed({ profileId, sort = "popular", limit = 30, offset = 0 } = {}) {
    const qs = new URLSearchParams({ 
      profileId: String(profileId || selectedId), 
      sort, 
      limit: String(limit),
      offset: String(offset),
    });
    const data = await apiGet(`${API_BASE}/feed?${qs.toString()}`);
    return data.items || [];
  }

  async function searchContent({ profileId, query, type = "", genre = "", year_from = "", year_to = "", sort = "popular", limit = 50, offset = 0 }) {
    const qs = new URLSearchParams({
      profileId: String(profileId || selectedId),
      query: String(query || ""),
      type: String(type || ""),
      genre: String(genre || ""),
      year_from: String(year_from || ""),
      year_to: String(year_to || ""),
      sort, 
      limit: String(limit),
      offset: String(offset),
    });
    const data = await apiGet(`${API_BASE}/search?${qs.toString()}`);
    return data.items || [];
  }

  async function loadRecommendations({ profileId, limit = 20, offset = 0 } = {}) {
    const qs = new URLSearchParams({ 
      profileId: String(profileId || selectedId), 
      limit: String(limit),
      offset: String(offset),
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

    const coverSrc = normalizePath(item.cover || item.imagePath || '');
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
    const tagsHtml = tags.length
      ? `<div class="nf-card__tags">${tags.map((tag) => `<span class="nf-tag">${tag}</span>`).join('')}</div>`
      : '';
    card.innerHTML = `
      <div class="nf-card__cover">
        <img src="${coverSrc}" alt="${item.title || ''}" loading="lazy"
             onerror="this.onerror=null;this.style.display='none';" />
        ${withProgress ? `<div class="nf-progress"><div class="nf-progress__bar" style="width:${prog}%"></div></div>` : ``}
      </div>
      <div class="nf-card__meta">
        <div class="nf-card__title" title="${item.title || ''}">${item.title || ''}</div>
        <div class="nf-card__sub">${[item.year, item.type].filter(Boolean).join(" • ")}</div>
        ${tagsHtml}
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
  
  function escapeAttrValue(value) {
    const str = String(value ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(str);
    }
    return str.replace(/["\\]/g, "\\$&");
  }

  function syncCardLikeState(extId, liked, likeCount) {
    const escaped = escapeAttrValue(extId);
    const buttons = document.querySelectorAll(`.nf-card[data-ext-id="${escaped}"] .like-btn`);
    buttons.forEach(btn => {
      btn.classList.toggle("liked", !!liked);
      btn.setAttribute("aria-pressed", String(!!liked));
      const countEl = btn.querySelector(".like-count");
      if (countEl) countEl.textContent = String(Math.max(0, Number(likeCount || 0)));
    });
  }
  
  function updateArrowStates(scroller, leftArrow, rightArrow) {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const x = scroller.scrollLeft;
    setBtnDisabled(leftArrow,  x <= 5);
    setBtnDisabled(rightArrow, x >= (maxScroll - 5));
  }

  function makeRow({ id, title, items, withProgress = false, loadMore = null, pageSize = 0, initialOffset = 0, allowLoop = true }) {
    const rowSeen = new Set();
    const rawItems = Array.isArray(items) ? items : [];
    const initialItems = dedupeByExtId(rawItems, rowSeen);
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
    initialItems.forEach(item => scroller.appendChild(createCard(item, withProgress)));

    const left = section.querySelector(".nf-row__arrow--left");
    const right = section.querySelector(".nf-row__arrow--right");
    const initialCount = initialItems.length;
    const initialCountRaw = rawItems.length;
    const canLoop = allowLoop && !loadMore && initialCount >= LOOP_MIN_ITEMS;
    const state = {
      loadMore,
      pageSize: pageSize > 0 ? pageSize : 0,
      offset: initialOffset + initialCountRaw,
      isFetching: false,
      exhausted: !loadMore,
      loop: canLoop,
      loopSeedCount: canLoop ? Math.max(0, initialCount) : 0,
      loopBlocks: canLoop ? 1 : 0,
      loopActivated: false,
    };
    if (loadMore) state.exhausted = false;

    function getGapPx() {
      const styles = window.getComputedStyle(scroller);
      const gapStr = styles.columnGap || styles.gap || "0";
      const parsed = parseFloat(gapStr);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function cardWidthPx() {
      const card = scroller.querySelector(".nf-card");
      if (!card) return scroller.clientWidth || 0;
      const rect = card.getBoundingClientRect();
      return rect.width;
    }

    function scrollAmountPx() {
      const cardWidth = cardWidthPx();
      const gap = getGapPx();
      const cardsToScroll = Math.max(1, ROW_SCROLL_STEP);
      const totalGap = gap * Math.max(0, cardsToScroll - 1);
      const amount = (cardWidth * cardsToScroll) + totalGap;
      return amount > 0 ? amount : (scroller.clientWidth || 0);
    }

    function loopThresholdPx() {
      const base = scrollAmountPx();
      return base > 0 ? base : Math.max(12, scroller.clientWidth * 0.25);
    }

    function updateArrows() {
      updateArrowStates(scroller, left, right);
      const loopEnabled = state.loop && scroller.childElementCount > 0 && scroller.scrollWidth > scroller.clientWidth + 1;
      if (loopEnabled) {
        setBtnDisabled(left, false);
        setBtnDisabled(right, false);
      }
    }

    function measureBlockWidth(count) {
      if (!count || !scroller.firstElementChild) return 0;
      const nodes = Array.from(scroller.children).slice(0, count);
      if (!nodes.length) return 0;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const start = first.offsetLeft;
      const end = last.offsetLeft + last.offsetWidth;
      return Math.max(0, end - start);
    }

    function appendLoopBlock() {
      if (!state.loopSeedCount) return;
      const sample = Array.from(scroller.children).slice(0, state.loopSeedCount);
      if (!sample.length) return;
      const frag = document.createDocumentFragment();
      sample.forEach(node => frag.appendChild(node.cloneNode(true)));
      scroller.appendChild(frag);
      state.loopBlocks += 1;
    }

    function trimLeadingBlock() {
      if (state.loopBlocks <= 2 || !state.loopSeedCount) return;
      const toRemove = Array.from(scroller.children).slice(0, state.loopSeedCount);
      if (!toRemove.length) return;
      const adjust = measureBlockWidth(state.loopSeedCount);
      toRemove.forEach(node => node.remove());
      state.loopBlocks = Math.max(1, state.loopBlocks - 1);
      if (adjust > 0) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - adjust);
    }

    function ensureLoopContinuity() {
      if (!state.loop || state.loopSeedCount === 0) return;
      if (!state.loopActivated) {
        state.loopSeedCount = Math.max(0, scroller.childElementCount);
        state.loopBlocks = 1;
        state.loopActivated = true;
        appendLoopBlock();
      }
      const threshold = Math.max(loopThresholdPx(), scroller.clientWidth || 0);
      const remaining = Math.max(0, scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft);
      if (remaining < threshold) appendLoopBlock();
      if (scroller.scrollLeft > threshold * 2) trimLeadingBlock();
    }

    async function fetchMore() {
      if (!state.loadMore || state.exhausted || state.isFetching) return;
      state.isFetching = true;
      right.classList.add("is-loading");
      try {
        const params = { offset: state.offset };
        if (state.pageSize > 0) params.limit = state.pageSize;
        const fetched = await state.loadMore(params);
        const fetchedList = Array.isArray(fetched) ? fetched : [];
        const nextItems = dedupeByExtId(fetchedList, rowSeen);
        if (nextItems.length) {
          state.loop = false;
          state.loopSeedCount = allowLoop ? Math.max(0, scroller.childElementCount + nextItems.length) : 0;
          state.loopBlocks = allowLoop ? 1 : 0;
          state.loopActivated = false;
          nextItems.forEach(item => scroller.appendChild(createCard(item, withProgress)));
        }

        state.offset += fetchedList.length;

        if (state.pageSize > 0 && fetchedList.length < state.pageSize) {
          state.exhausted = true;
          if (scroller.childElementCount > 0) {
            const total = scroller.childElementCount;
            const loopPossible = allowLoop && total >= LOOP_MIN_ITEMS;
            state.loop = loopPossible;
            state.loopSeedCount = loopPossible ? Math.max(0, total) : 0;
            state.loopBlocks = loopPossible ? 1 : 0;
            state.loopActivated = false;
          }
        } else if (!nextItems.length && fetchedList.length) {
          // All fetched items were duplicates already in the row; try again soon.
          requestAnimationFrame(maybeLoadMore);
        } else if (!nextItems.length) {
          state.exhausted = true;
          if (scroller.childElementCount > 0) {
            const total = scroller.childElementCount;
            const loopPossible = allowLoop && total >= LOOP_MIN_ITEMS;
            state.loop = loopPossible;
            state.loopSeedCount = loopPossible ? Math.max(0, total) : 0;
            state.loopBlocks = loopPossible ? 1 : 0;
            state.loopActivated = false;
          }
        }
      } catch (err) {
        console.error(`loadMore failed for row ${id}:`, err);
      } finally {
        state.isFetching = false;
        right.classList.remove("is-loading");
        requestAnimationFrame(() => {
          updateArrows();
          ensureLoopContinuity();
          maybeLoadMore();
        });
      }
    }

    function maybeLoadMore() {
      if (!state.loadMore || state.exhausted || state.isFetching) return;
      const maxScrollable = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      if (maxScrollable <= 0) return; // nothing to scroll, no need to fetch more
      const remaining =
        Math.max(0, scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft);
      if (remaining <= scrollAmountPx() * 1.5) {
        fetchMore();
      }
    }

    requestAnimationFrame(() => {
      updateArrows();
      ensureLoopContinuity();
      maybeLoadMore();
    });

    let t;
    scroller.addEventListener("scroll", () => {
      clearTimeout(t);
      ensureLoopContinuity();
      t = setTimeout(() => {
        updateArrows();
        ensureLoopContinuity();
        maybeLoadMore();
      }, 50);
    });

    left.addEventListener("click", (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (left.disabled) return;
      scroller.scrollBy({ left: -scrollAmountPx(), behavior: "smooth" });
      setTimeout(() => {
        updateArrows();
        ensureLoopContinuity();
        maybeLoadMore();
      }, 350);
    });
    
    right.addEventListener("click", (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (right.disabled) return;
      if (!state.loop) {
        maybeLoadMore();
      }
      scroller.scrollBy({ left: scrollAmountPx(), behavior: "smooth" });
      setTimeout(() => {
        updateArrows();
        ensureLoopContinuity();
        if (!state.loop) maybeLoadMore();
      }, 350);
    });

    ROW_META.set(scroller, { maybeLoadMore, updateArrows, ensureLoopContinuity, state });

    return section;
  }

  function refreshAllArrows() {
    document.querySelectorAll(".nf-row").forEach(row => {
      const scroller = row.querySelector(".nf-row__scroller");
      const left = row.querySelector(".nf-row__arrow--left");
      const right = row.querySelector(".nf-row__arrow--right");
      if (scroller && left && right) {
        updateArrowStates(scroller, left, right);
        const meta = ROW_META.get(scroller);
        if (meta?.ensureLoopContinuity) meta.ensureLoopContinuity();
        if (meta?.maybeLoadMore) meta.maybeLoadMore();
      }
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
    const heroImg = normalizePath(featured.backdrop || featured.cover || featured.imagePath || '');
    hero.innerHTML = `
      <div class="nf-hero__bg" style="background-image:url('${heroImg}')"></div>
      <div class="nf-hero__meta" dir="rtl">
        <h1 class="nf-hero__title">${featured.title}</h1>
        <div class="nf-hero__sub">${[featured.year, (featured.genres||[]).join(" • "), featured.type].filter(Boolean).join(" • ")}</div>
      </div>
    `;
  }

  // ===== 5) Build rows (default/search/recommend)
  const rowsRoot = document.getElementById("rows");

  // ===== 5a) Infinite scroll state & helpers =====
  async function loadHomeContent(sortMode = "popular") {
    const POP_LIMIT = 16;
    const GEN_LIMIT = 16;
    const CLASSIC_LIMIT = 12;
    const REC_LIMIT = 16;

    const ratedPromise = sortMode === "alpha"
      ? Promise.resolve([])
      : loadFeed({ profileId: selectedId, sort: "rating", limit: POP_LIMIT });

    const [popular, sciFi, drama, classics, recs, rated] = await Promise.all([
      loadFeed({ profileId: selectedId, sort: sortMode, limit: POP_LIMIT }),
      searchContent({ profileId: selectedId, genre: "sci-fi", sort: sortMode, limit: GEN_LIMIT }),
      searchContent({ profileId: selectedId, genre: "drama",  sort: sortMode, limit: GEN_LIMIT }),
      searchContent({ profileId: selectedId, year_to: "1999", sort: sortMode, limit: CLASSIC_LIMIT }),
      loadRecommendations({ profileId: selectedId, limit: REC_LIMIT }),
      ratedPromise,
    ]);

    const rows = [
      { 
        id: "row-recs",    
        title: `Recommended for you`, 
        items: recs || [],
        pageSize: REC_LIMIT,
        loadMore: ({ offset = 0, limit = REC_LIMIT } = {}) =>
          loadRecommendations({ profileId: selectedId, limit, offset }),
      },
      { 
        id: "row-popular", 
        title: sortMode === "alpha" ? "A–Z Catalog" : "Popular on Netflix", 
        items: popular || [],
        pageSize: POP_LIMIT,
        loadMore: ({ offset = 0, limit = POP_LIMIT } = {}) =>
          loadFeed({ profileId: selectedId, sort: sortMode, limit, offset }),
      },
      ...(sortMode === "alpha"
        ? []
        : [{
            id: "row-rated",
            title: "Most Rated on IMDb",
            items: rated || [],
            pageSize: POP_LIMIT,
            loadMore: ({ offset = 0, limit = POP_LIMIT } = {}) =>
              loadFeed({ profileId: selectedId, sort: "rating", limit, offset }),
          }]
      ),
    { 
      id: "row-sci",     
      title: sortMode === "alpha" ? "Sci-Fi & Fantasy (A–Z)" : "Sci-Fi & Fantasy", 
        items: sciFi || [],
        pageSize: GEN_LIMIT,
        loadMore: ({ offset = 0, limit = GEN_LIMIT } = {}) =>
          searchContent({ profileId: selectedId, genre: "sci-fi", sort: sortMode, limit, offset }),
      },
      { 
        id: "row-drama",   
        title: sortMode === "alpha" ? "Drama (A–Z)" : "Critically-acclaimed Drama", 
        items: drama || [],
        pageSize: GEN_LIMIT,
        loadMore: ({ offset = 0, limit = GEN_LIMIT } = {}) =>
          searchContent({ profileId: selectedId, genre: "drama",  sort: sortMode, limit, offset }),
      },
      { 
        id: "row-classic", 
        title: sortMode === "alpha" ? "Classics (A–Z)" : "Classics", 
        items: classics || [],
        pageSize: CLASSIC_LIMIT,
        loadMore: ({ offset = 0, limit = CLASSIC_LIMIT } = {}) =>
          searchContent({ profileId: selectedId, year_to: "1999", sort: sortMode, limit, offset }),
      },
    ];

    return { popular, sciFi, drama, classics, recs, rows };
  }

  async function appendHomeCycle(sortMode = lastSort) {
    try {
      const { rows } = await loadHomeContent(sortMode);
      // Append again (we do NOT de-dupe here so the loop visibly repeats)
      rows
        .map((r, idx) => ({
          ...r,
          id: `${r.id}-loop-${Date.now()}-${idx}`,
        }))
        .forEach(r => { if (r.items?.length) rowsRoot.appendChild(makeRow(r)); });
    } catch (err) {
      console.error("appendHomeCycle error:", err);
    }
  }

  const GENRE_SEQ = [
    "action","comedy","thriller","romance","documentary","animation",
    "crime","family","horror","fantasy","adventure","history","war","music","mystery","western"
  ];
  let nextGenreIdx = 0;
  let isLoadingMore = false;
  let isInfiniteEnabled = false;
  function dedupeByExtId(items = [], seen = new Set()) {
    const out = [];
    items.forEach((item) => {
      const key = String(item?.extId ?? item?.id ?? "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  let sentinel = null;
  let io = null;

  function ensureSentinel() {
    if (sentinel) return sentinel;
    sentinel = document.createElement("div");
    sentinel.id = "infinite-sentinel";
    sentinel.style.cssText = "height:1px;margin:0;opacity:0;";
    // place after the rows section so it’s near the bottom of the page
    rowsRoot.parentElement.appendChild(sentinel);
    return sentinel;
  }

  async function appendRowsBatch() {
    if (isLoadingMore || !isInfiniteEnabled) return;
    isLoadingMore = true;
    try {
      const batch = [];

      // If we still have genres, load a small batch of 3 rows
      if (nextGenreIdx < GENRE_SEQ.length) {
        const sortForRow = lastSort;
        const ROW_LIMIT = 16;
        for (let k = 0; k < 3 && nextGenreIdx < GENRE_SEQ.length; k++) {
          const g = GENRE_SEQ[nextGenreIdx++];
          const itemsRaw = await searchContent({
            profileId: selectedId,
            genre: g,
            sort: sortForRow,
            limit: ROW_LIMIT
          });
          const items = dedupeByExtId(itemsRaw);
          if (items.length) {
            batch.push({
              id: `row-${g}-${Date.now()}-${k}`,
              title: (sortForRow === "alpha") ? `${g[0].toUpperCase()+g.slice(1)} (A–Z)` : (g[0].toUpperCase()+g.slice(1)),
              items,
              pageSize: ROW_LIMIT,
              loadMore: ({ offset = 0, limit = ROW_LIMIT } = {}) =>
                searchContent({ profileId: selectedId, genre: g, sort: sortForRow, limit, offset }),
            });
          }
        }
        batch.forEach(r => rowsRoot.appendChild(makeRow(r)));
      }

      // If we ran out of genres, append the home set again and restart the genre sequence
      if (nextGenreIdx >= GENRE_SEQ.length) {
        await appendHomeCycle(lastSort);
        nextGenreIdx = 0;           // restart genre loop
      }
    } catch (err) {
      console.error("Infinite scroll load error:", err);
      showAlert({ type: "error", title: "Loading more failed", message: err?.message || "Couldn’t load more rows." });
    } finally {
      isLoadingMore = false;
    }
  }


  function enableInfinite() {
    if (isInfiniteEnabled) return;
    isInfiniteEnabled = true;
    const s = ensureSentinel();
    io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) appendRowsBatch();
    }, { root: null, rootMargin: "800px 0px", threshold: 0 });
    io.observe(s);
  }

  function disableInfinite() {
    isInfiniteEnabled = false;
    if (io) { io.disconnect(); io = null; }
    if (sentinel) { sentinel.remove(); sentinel = null; }
  }


  async function displayDefaultRows(sortMode = "popular") {
    if (!rowsRoot) return;
    rowsRoot.innerHTML = "";
    disableInfinite();

    // reset paging state
    nextGenreIdx = 0;
    isLoadingMore = false;

    try {
      const { popular, sciFi, drama, classics, recs, rows } = await loadHomeContent(sortMode);

      CURRENT_ITEMS = popular.slice();

      displayFeatured(CURRENT_ITEMS);

      rows.forEach(r => { if (r.items?.length) rowsRoot.appendChild(makeRow(r)); });

      // turn on infinite scroll after initial rows render
      enableInfinite();
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
      disableInfinite();
      rowsRoot.innerHTML = "";
      
      if (!results?.length) {
        rowsRoot.innerHTML = `<div style="text-align:center; padding:40px; color:#999;">No results for "${query}"</div>`;
        return;
      }
      
      CURRENT_ITEMS = results.slice();
      const row = { 
        id: "row-search", 
        title: `Search Results for "${query}" (${results.length})`, 
        items: results,
        allowLoop: false,
      };
      rowsRoot.appendChild(makeRow(row));
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
      syncCardLikeState(extId, goingLiked, optimistic);

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
        const resolvedLikes = Math.max(0, Number(likes || 0));
        if (countEl) countEl.textContent = String(resolvedLikes);
        syncCardLikeState(extId, !!liked, resolvedLikes);
        
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
        syncCardLikeState(extId, wasLiked, prev);
        if (err?.message?.includes('Admin is not allowed to like')) {
          showAlert({
            type: 'info',
            title: 'Admin mode',
            message: 'Admin accounts cannot like titles.',
          });
        } else {
          showAlert({ 
            type: 'error', 
            title: 'Like failed', 
            message: err?.message || 'Error while updating like' 
          });
        }
      } finally {
        delete btn.dataset.busy;
        btn.removeAttribute("aria-busy");
      }
    }, false);
  }

  // ===== 6b) Card click -> title page
  if (rowsRoot) {
    rowsRoot.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      // ignore clicks on interactive elements
      if (e.target.closest('.like-btn, .nf-row__arrow, button, a, input, select, textarea')) return;
      const card = e.target.closest('.nf-card');
      if (!card) return;
      const extId = String(card.dataset.extId || '');
      if (!extId) return;
      e.preventDefault();
      window.location.href = `title.html?extId=${encodeURIComponent(extId)}`;
    });
  }

  // ===== 7) Search UI + behavior (ENHANCED)
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
      // If there's a search query, re-run the search with new sort
      performSearchNow(q);
    } else {
      // No search query, reload default rows with new sort
      displayDefaultRows(lastSort);
    }
  }

  if (alphaToggle) {
    const onAlpha = (e) => {
      const newMode = alphaToggle.checked ? "alpha" : "popular";
      console.log('A-Z toggle changed to:', newMode); // Debug log
      setSort(newMode);
    };
    alphaToggle.addEventListener("change", onAlpha);
    
    // Prevent label click from bubbling
    const label = alphaToggle.closest('label');
    if (label) {
      label.addEventListener("click", (e) => { 
        e.stopPropagation(); 
      });
    }
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
  
  // Enhanced search that searches by title, genre, and type
  async function performSearchNow(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) { 
      await displayDefaultRows(lastSort); 
      return; 
    }
    
    try {
      // Search by title
      const titleResults = await searchContent({ 
        profileId: selectedId, 
        query: q, 
        sort: lastSort, 
        limit: 50 
      });
      
      // Search by genre
      const genreResults = await searchContent({ 
        profileId: selectedId, 
        genre: q, 
        sort: lastSort, 
        limit: 50 
      });
      
      // Search by type (movie/series)
      let typeResults = [];
      if (q.includes('movie') || q.includes('film')) {
        typeResults = await searchContent({ 
          profileId: selectedId, 
          type: 'movie', 
          sort: lastSort, 
          limit: 50 
        });
      } else if (q.includes('series') || q.includes('show') || q.includes('tv')) {
        typeResults = await searchContent({ 
          profileId: selectedId, 
          type: 'series', 
          sort: lastSort, 
          limit: 50 
        });
      }
      
      // Combine and deduplicate results
      const allResults = [...titleResults, ...genreResults, ...typeResults];
      const uniqueMap = new Map();
      
      allResults.forEach(item => {
        const key = item.extId || item.id;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        }
      });
      
      const results = Array.from(uniqueMap.values());
      displaySearchResults(results, query);
    } catch (err) { 
      console.error("Search error:", err); 
      showAlert({ 
        type: 'error', 
        title: 'Search failed', 
        message: err?.message || 'Error while searching' 
      });
    }
  }
  
  async function performSearch(query) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearchNow(query), 300);
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
      setProfileMenu(false);
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
