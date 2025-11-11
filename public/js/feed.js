// JS/feed.js 

document.addEventListener("DOMContentLoaded", async () => {
  // prevent default on dead links
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
  const hideWatchedKey = `hide_watched_${selectedId}`;
  let hideWatched = localStorage.getItem(hideWatchedKey) === "1";
  const hideWatchedBtn = document.getElementById("toggleWatchedBtn");
  const newestGenreBtn = document.getElementById("newestGenreBtn");
  const alphaToggle = document.getElementById("alphaToggle");
  const SORT_KEY = "nf_sort_mode";
  const NEWEST_MODE_KEY = "nf_sort_newest";
  let baseSort = localStorage.getItem(SORT_KEY) === "alpha" ? "alpha" : "popular";
  let newestSortEnabled = localStorage.getItem(NEWEST_MODE_KEY) === "1";
  let lastSort = newestSortEnabled ? "newest" : baseSort;

  function applyCardVisibility(card) {
    if (!card) return;
    const isWatchedCard = card.dataset?.watched === "1";
    const shouldHide = hideWatched && isWatchedCard;
    if (shouldHide) {
      card.style.display = "none";
      card.setAttribute("aria-hidden", "true");
      card.classList.add("nf-card--filtered");
    } else {
      card.style.display = "";
      card.removeAttribute("aria-hidden");
      card.classList.remove("nf-card--filtered");
    }
  }

  function applyWatchedFilter(root = document) {
    if (!root) return;
    if (root.classList && root.classList.contains("nf-card")) {
      applyCardVisibility(root);
      return;
    }
    const scope =
      typeof root.querySelectorAll === "function"
        ? root.querySelectorAll(".nf-card")
        : document.querySelectorAll(".nf-card");
    scope.forEach((card) => applyCardVisibility(card));
  }

  function updateHideWatchedButton() {
    if (!hideWatchedBtn) return;
    hideWatchedBtn.textContent = hideWatched ? "Show Watched" : "Hide Watched";
    hideWatchedBtn.setAttribute("aria-pressed", String(hideWatched));
    hideWatchedBtn.classList.toggle("is-active", hideWatched);
  }

  function updateNewestButtonState() {
    if (!newestGenreBtn) return;
    newestGenreBtn.classList.toggle("is-active", newestSortEnabled);
    newestGenreBtn.setAttribute("aria-pressed", String(newestSortEnabled));
  }

  function updateSortButtonStates() {
    if (alphaToggle) alphaToggle.checked = baseSort === "alpha";
    updateNewestButtonState();
  }

  if (hideWatchedBtn) {
    hideWatchedBtn.addEventListener("click", () => {
      hideWatched = !hideWatched;
      localStorage.setItem(hideWatchedKey, hideWatched ? "1" : "0");
      updateHideWatchedButton();
      applyWatchedFilter(document);
    });
    updateHideWatchedButton();
  }

  if (newestGenreBtn) {
    updateNewestButtonState();
    newestGenreBtn.addEventListener("click", () => {
      if (newestSortEnabled) {
        setSort(baseSort, { persistBase: false });
      } else {
        setSort("newest");
      }
    });
  }

  if (hideWatched) {
    applyWatchedFilter(document);
  }
  updateSortButtonStates();

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
  
  // Helper: Calculate scroll metrics (card width, gap, scroll amount, remaining distance)
  function getScrollMetrics(scroller, step = ROW_SCROLL_STEP) {
    const card = scroller.querySelector(".nf-card");
    const cardWidth = card?.getBoundingClientRect().width || scroller.clientWidth;
    const gap = parseFloat(window.getComputedStyle(scroller).gap || 0);
    const scrollAmount = (cardWidth * Math.max(1, step)) + (gap * Math.max(0, step - 1));
    const remaining = Math.max(0, scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft);
    return { scrollAmount: scrollAmount || scroller.clientWidth, remaining };
  }

  // Helper: Update arrow button states based on scroll position and loop mode
  function updateArrowStates(scroller, leftArrow, rightArrow, loopEnabled = false) {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const atStart = scroller.scrollLeft <= 5;
    const atEnd = scroller.scrollLeft >= maxScroll - 5;
    const hasScroll = scroller.scrollWidth > scroller.clientWidth + 1;
    
    // Helper to set arrow disabled state
    const setArrow = (btn, disabled) => {
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", String(disabled));
      btn.classList.toggle("is-disabled", disabled);
    };
    
    // If loop is enabled and row is scrollable, keep both arrows active
    if (loopEnabled && hasScroll) {
      setArrow(leftArrow, false);
      setArrow(rightArrow, false);
    } else {
      setArrow(leftArrow, atStart);
      setArrow(rightArrow, atEnd);
    }
  }

  // Helper: Deduplicate items by extId to prevent showing same content multiple times
  function dedupeByExtId(items = [], seen = new Set()) {
    return items.filter(item => {
      const key = String(item?.extId ?? item?.id ?? "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ===== 4) Rendering
  function getWatchedTag(tags) {
    if (!Array.isArray(tags)) return false;
    return tags.some((tag) => String(tag).trim().toLowerCase() === "watched");
  }

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
    const isWatched = getWatchedTag(tags);
    card.dataset.watched = isWatched ? "1" : "0";
    card.classList.toggle("nf-card--watched", isWatched);
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
    applyCardVisibility(card);
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

  function makeRow({ id, title, items, withProgress = false, loadMore = null, pageSize = 0, initialOffset = 0, allowLoop = true }) {
    // Track seen items to prevent duplicates in this row
    const rowSeen = new Set();
    const initialItems = dedupeByExtId(Array.isArray(items) ? items : [], rowSeen);
    
    // Build the row DOM structure
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
    const left = section.querySelector(".nf-row__arrow--left");
    const right = section.querySelector(".nf-row__arrow--right");

    // Render initial cards into the scroller
    initialItems.forEach(item => scroller.appendChild(createCard(item, withProgress)));
    if (hideWatched) applyWatchedFilter(scroller);

    // Initialize row state for pagination, looping, and loading
    const state = {
      loadMore,                                                           // Function to fetch more items
      pageSize: pageSize > 0 ? pageSize : 0,                             // Items per page
      offset: initialOffset + (Array.isArray(items) ? items.length : 0), // Current offset for pagination
      isFetching: false,                                                  // Prevent concurrent fetches
      exhausted: !loadMore,                                               // True when no more items to load
      loop: allowLoop && !loadMore && initialItems.length >= LOOP_MIN_ITEMS, // Enable seamless loop for static rows
      loopSeed: allowLoop && !loadMore && initialItems.length >= LOOP_MIN_ITEMS ? initialItems.length : 0, // Number of items to clone for loop
      loopActive: false                                                   // Track if loop has been activated
    };

    // Loop: Append duplicate cards to create seamless infinite scrolling effect
    const appendLoopBlock = () => {
      if (!state.loopSeed) return;
      const sample = Array.from(scroller.children).slice(0, state.loopSeed);
      if (!sample.length) return;
      const frag = document.createDocumentFragment();
      sample.forEach(node => frag.appendChild(node.cloneNode(true)));
      scroller.appendChild(frag);
    };

    // Ensure loop continuity: activate loop and append blocks as user scrolls near the end
    const ensureLoop = () => {
      if (!state.loop || !state.loopSeed) return;
      if (!state.loopActive) {
        state.loopSeed = scroller.childElementCount;
        state.loopActive = true;
        appendLoopBlock();
      }
      const { scrollAmount, remaining } = getScrollMetrics(scroller);
      if (remaining < Math.max(scrollAmount, scroller.clientWidth)) appendLoopBlock();
    };

    // Fetch more items from the server when user scrolls near the end
    const fetchMore = async () => {
      if (!state.loadMore || state.exhausted || state.isFetching) return;
      
      state.isFetching = true;
      right.classList.add("is-loading"); // Show loading indicator on right arrow
      
      try {
        const params = { offset: state.offset };
        if (state.pageSize > 0) params.limit = state.pageSize;
        
        const fetched = await state.loadMore(params);
        const fetchedList = Array.isArray(fetched) ? fetched : [];
        const nextItems = dedupeByExtId(fetchedList, rowSeen); // Remove duplicates
        
        if (nextItems.length) {
          state.loop = false; // Disable loop when adding new items
          nextItems.forEach(item => scroller.appendChild(createCard(item, withProgress)));
          if (hideWatched) applyWatchedFilter(scroller);
        }
        
        state.offset += fetchedList.length;
        
        // Check if we've exhausted all items from the server
        if ((state.pageSize > 0 && fetchedList.length < state.pageSize) || !nextItems.length) {
          state.exhausted = true;
          // Re-enable loop if we have enough items
          if (allowLoop && scroller.childElementCount >= LOOP_MIN_ITEMS) {
            state.loop = true;
            state.loopSeed = scroller.childElementCount;
            state.loopActive = false;
          }
        } else if (!nextItems.length && fetchedList.length) {
          // All fetched items were duplicates, try fetching again
          requestAnimationFrame(maybeLoadMore);
        }
      } catch (err) {
        console.error(`Row ${id} load error:`, err);
      } finally {
        state.isFetching = false;
        right.classList.remove("is-loading");
        requestAnimationFrame(() => {
          updateArrowStates(scroller, left, right, state.loop);
          ensureLoop();
          maybeLoadMore();
        });
      }
    };

    // Check if we should load more items based on remaining scroll distance
    const maybeLoadMore = () => {
      if (!state.loadMore || state.exhausted || state.isFetching) return;
      const maxScrollable = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      if (maxScrollable <= 0) return; // Nothing to scroll, no need to fetch
      const { scrollAmount, remaining } = getScrollMetrics(scroller);
      if (remaining <= scrollAmount * 1.5) fetchMore(); // Load when within 1.5 scroll amounts from end
    };

    // Scroll event handler with debouncing for performance
    let scrollTimer;
    scroller.addEventListener("scroll", () => {
      clearTimeout(scrollTimer);
      ensureLoop();
      scrollTimer = setTimeout(() => {
        updateArrowStates(scroller, left, right, state.loop);
        ensureLoop();
        maybeLoadMore();
      }, 50);
    });

    // Arrow click handlers: scroll left or right by calculated amount
    const handleScroll = (direction) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      const arrow = direction === 'left' ? left : right;
      if (arrow.disabled) return;
      
      const { scrollAmount } = getScrollMetrics(scroller);
      if (direction === 'right' && !state.loop) maybeLoadMore(); // Preload when scrolling right
      
      scroller.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: "smooth" });
      
      // Update UI after scroll animation completes
      setTimeout(() => {
        updateArrowStates(scroller, left, right, state.loop);
        ensureLoop();
        if (direction === 'right' && !state.loop) maybeLoadMore();
      }, 350);
    };

    left.addEventListener("click", handleScroll('left'));
    right.addEventListener("click", handleScroll('right'));

    // Initial setup: update arrows, activate loop if needed, and check for more items
    requestAnimationFrame(() => {
      updateArrowStates(scroller, left, right, state.loop);
      ensureLoop();
      maybeLoadMore();
    });

    // Store metadata for external access (e.g., refreshAllArrows function)
    ROW_META.set(scroller, { 
      maybeLoadMore, 
      updateArrows: () => updateArrowStates(scroller, left, right, state.loop), 
      ensureLoopContinuity: ensureLoop, 
      state 
    });

    return section;
  }

  function refreshAllArrows() {
    document.querySelectorAll(".nf-row").forEach(row => {
      const scroller = row.querySelector(".nf-row__scroller");
      const left = row.querySelector(".nf-row__arrow--left");
      const right = row.querySelector(".nf-row__arrow--right");
      if (scroller && left && right) {
        const meta = ROW_META.get(scroller);
        if (meta?.updateArrows) meta.updateArrows();
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
    const isNewest = sortMode === "newest";
    const POP_LIMIT = isNewest ? 10 : 16;
    const GEN_LIMIT = isNewest ? 10 : 16;
    const CLASSIC_LIMIT = isNewest ? 10 : 12;
    const REC_LIMIT = isNewest ? 10 : 16;

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
        title: sortMode === "alpha"
          ? "A–Z Catalog"
          : (isNewest ? "Newest on Netflix" : "Popular on Netflix"), 
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
      title: sortMode === "alpha"
        ? "Sci-Fi & Fantasy (A–Z)"
        : (isNewest ? "Sci-Fi & Fantasy (Newest)" : "Sci-Fi & Fantasy"), 
        items: sciFi || [],
        pageSize: GEN_LIMIT,
        loadMore: ({ offset = 0, limit = GEN_LIMIT } = {}) =>
          searchContent({ profileId: selectedId, genre: "sci-fi", sort: sortMode, limit, offset }),
      },
      { 
        id: "row-drama",   
        title: sortMode === "alpha"
          ? "Drama (A–Z)"
          : (isNewest ? "Drama (Newest)" : "Critically-acclaimed Drama"), 
        items: drama || [],
        pageSize: GEN_LIMIT,
        loadMore: ({ offset = 0, limit = GEN_LIMIT } = {}) =>
          searchContent({ profileId: selectedId, genre: "drama",  sort: sortMode, limit, offset }),
      },
      { 
        id: "row-classic", 
        title: sortMode === "alpha"
          ? "Classics (A–Z)"
          : (isNewest ? "Classics (Newest)" : "Classics"), 
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

  let sentinel = null;
  let io = null;

  function ensureSentinel() {
    if (sentinel) return sentinel;
    sentinel = document.createElement("div");
    sentinel.id = "infinite-sentinel";
    sentinel.style.cssText = "height:1px;margin:0;opacity:0;";
    // place after the rows section so it's near the bottom of the page
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
        const ROW_LIMIT = sortForRow === "newest" ? 10 : 16;
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
            const cap = g[0].toUpperCase() + g.slice(1);
            let rowTitle = cap;
            if (sortForRow === "alpha") rowTitle = `${cap} (A–Z)`;
            else if (sortForRow === "newest") rowTitle = `${cap} (Newest)`;
            batch.push({
              id: `row-${g}-${Date.now()}-${k}`,
              title: rowTitle,
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
      showAlert({ type: "error", title: "Loading more failed", message: err?.message || "Couldn't load more rows." });
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

  function applySort(mode) {
    lastSort = mode;
    const q = (searchInput?.value || "").trim();
    if (q) {
      performSearchNow(q);
    } else {
      displayDefaultRows(lastSort);
    }
  }

  function setSort(mode, { persistBase = false } = {}) {
    if (mode === "newest") {
      newestSortEnabled = true;
      localStorage.setItem(NEWEST_MODE_KEY, "1");
      updateSortButtonStates();
      applySort("newest");
      return;
    }

    newestSortEnabled = false;
    localStorage.setItem(NEWEST_MODE_KEY, "0");

    if (persistBase) {
      baseSort = mode === "alpha" ? "alpha" : "popular";
      localStorage.setItem(SORT_KEY, baseSort);
    }

    updateSortButtonStates();
    applySort(baseSort);
  }

  if (alphaToggle) {
    const onAlpha = () => {
      const newMode = alphaToggle.checked ? "alpha" : "popular";
      setSort(newMode, { persistBase: true });
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