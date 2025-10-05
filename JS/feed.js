document.addEventListener("DOMContentLoaded", async () => {
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

  // --------- Fetch catalog from server (fallback to /content.json) ---------
  async function fetchCatalog() {
    const tryApi = async () => {
      const res = await fetch("/api/content", { headers: { "Accept": "application/json" } });
      if (!res.ok) return [];
      const data = await res.json();
      const norm = normalize(data);
      return norm;
    };
    const tryStatic = async () => {
      const res = await fetch("/content.json", { headers: { "Accept": "application/json" } });
      if (!res.ok) return [];
      const data = await res.json();
      return normalize(data);
    };

    try {
      const api = await tryApi();
      if (Array.isArray(api) && api.length) return api;
    } catch {}
    try {
      const stat = await tryStatic();
      if (Array.isArray(stat) && stat.length) return stat;
    } catch {}
    return [];
  }

  function normalize(raw) {
    const list = (() => {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === "object") {
        if (Array.isArray(raw.items)) return raw.items;
        if (Array.isArray(raw.catalog)) return raw.catalog;
        if (Array.isArray(raw.data)) return raw.data;
        const vals = Object.values(raw).filter(Array.isArray).flat();
        if (Array.isArray(vals)) return vals;
      }
      return [];
    })();
    return list.map(it => {
      const title = it.title || it.name || "Untitled";
      const genres = Array.isArray(it.genres) ? it.genres
                    : Array.isArray(it.genre) ? it.genre
                    : (typeof it.genre === "string" ? it.genre.split(",").map(s=>s.trim()).filter(Boolean) : []);
      const type = it.type || (it.seasons ? "Series" : "Movie");
      return {
        id: String(it.id ?? title),
        title,
        year: it.year ?? it.releaseYear ?? "",
        genres,
        likes: Number.isFinite(it.likes) ? Number(it.likes) : 0,
        cover: it.cover || it.poster || it.image || it.img || "",
        backdrop: it.backdrop || it.background || "",
        type
      };
    });
  }

  const CATALOG = await fetchCatalog();

  // --------- Likes state (per profile) ---------
  const likesKey = `likes_by_${selectedId}`;
  const likesState = JSON.parse(localStorage.getItem(likesKey) || "{}");
  function getLikeEntry(item) {
    const entry = likesState[item.id];
    if (entry && typeof entry.count === "number") return entry;
    return { liked: false, count: Number.isFinite(item.likes) ? item.likes : 0 };
  }
  function saveLikes() { localStorage.setItem(likesKey, JSON.stringify(likesState)); }
  function currentCount(item) { return getLikeEntry(item).count; }

  // --------- Hero (featured) ---------
  function mostLiked(items) {
    if (!items.length) return null;
    return items.reduce((best, cur) => (currentCount(cur) > currentCount(best) ? cur : best), items[0]);
  }

  const hero = document.getElementById("hero");
  const featured = mostLiked(CATALOG);
  if (hero && featured) {
    const heroImg = featured.backdrop || featured.cover || "";
    hero.innerHTML = `
      <div class="nf-hero__bg" style="background-image:url('${heroImg}')"></div>
      <div class="nf-hero__meta" dir="rtl">
        <h1 class="nf-hero__title">${featured.title}</h1>
        <div class="nf-hero__sub">${[featured.year, (featured.genres||[]).join(" • "), featured.type].filter(Boolean).join(" • ")}</div>
        <div class="nf-hero__actions">
          <button class="nf-cta nf-cta--play" id="btnPlay">
            <svg viewBox="0 0 24 24" class="nf-cta__icon" aria-hidden="true"><path d="M6 4l14 8-14 8z"></path></svg>
            <span>Play</span>
          </button>
          <button class="nf-cta nf-cta--info" id="btnInfo" aria-haspopup="dialog" aria-controls="infoDialog">
            <svg viewBox="0 0 24 24" width="24" height="24" class="nf-cta__icon" aria-hidden="true" fill="none" role="img">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM0 12C0 5.37258 5.37258 0 12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12ZM13 10V18H11V10H13ZM12 8.5C12.8284 8.5 13.5 7.82843 13.5 7C13.5 6.17157 12.8284 5.5 12 5.5C11.1716 5.5 10.5 6.17157 10.5 7C10.5 7.82843 11.1716 8.5 12 8.5Z" fill="currentColor"></path>
            </svg>
            <span>More Info</span>
          </button>
        </div>
      </div>
    `;
  }

  // --------- Rows model ---------
  const rowsRoot = document.getElementById("rows");

  const progressKey = `progress_by_${selectedId}`;
  const progress = JSON.parse(localStorage.getItem(progressKey) || "{}");
  if (!Object.keys(progress).length) {
    CATALOG.slice(0, 8).forEach(i => (progress[i.id] = Math.floor(Math.random() * 80) + 10));
    localStorage.setItem(progressKey, JSON.stringify(progress));
  }

  const byGenre = (g) => CATALOG.filter((i) => Array.isArray(i.genres) && i.genres.includes(g));
  const classics = CATALOG.filter((i) => Number(i.year) && Number(i.year) <= 1999).slice(0, 12);
  const popular  = CATALOG.slice().sort((a, b) => currentCount(b) - currentCount(a)).slice(0, 14);
  const continueWatching = CATALOG.filter((i) => progress[i.id] > 0).slice(0, 12);

  let rowsModel = [
    { id: "row-popular",  title: "Popular on Netflix", items: popular },
    { id: "row-continue", title: `Continue Watching for ${profileName}`, items: continueWatching, withProgress: true },
    { id: "row-sci",      title: "Sci-Fi & Fantasy", items: byGenre("Sci-Fi").concat(byGenre("Fantasy")).slice(0, 14) },
    { id: "row-drama",    title: "Critically-acclaimed Drama", items: byGenre("Drama").slice(0, 14) },
    { id: "row-classic",  title: "Classics", items: classics },
  ];

  const alphaToggle = document.getElementById("alphaToggle");
  function sortRowItems(model, alpha) {
    const copy = JSON.parse(JSON.stringify(model));
    if (!alpha) return copy;
    copy.forEach((r) => r.items.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" })));
    return copy;
  }

  function createCard(item, withProgress = false) {
    const p = progress[item.id] || 0;
    const entry = getLikeEntry(item);
    const sub = [item.year ? String(item.year) : "", item.type || ""].filter(Boolean).join(" • ");
    const imgSrc = item.cover || item.backdrop || "";

    const card = document.createElement("article");
    card.className = "nf-card";
    card.dataset.title = (item.title || "").toLowerCase();
    card.dataset.itemId = item.id;
    card.innerHTML = `
      <div class="nf-card__cover">
        ${imgSrc ? `<img src="${imgSrc}" alt="${item.title}" loading="lazy" onerror="this.onerror=null;this.style.display='none';" />` : `<div class="nf-card__placeholder">No image</div>`}
        ${withProgress ? `<div class="nf-progress"><div class="nf-progress__bar" style="width:${p}%"></div></div>` : ``}
      </div>
      <div class="nf-card__meta">
        <div class="nf-card__title" title="${item.title}">${item.title}</div>
        <div class="nf-card__sub">${sub}</div>
        <button class="btn btn-sm rounded-pill like-btn ${entry.liked ? "liked" : ""}" type="button" aria-pressed="${entry.liked}" aria-label="Like ${item.title}">
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

  function updateArrowStates(scroller, leftArrow, rightArrow) {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const x = scroller.scrollLeft;
    leftArrow.disabled  = x <= 5;
    rightArrow.disabled = x >= (maxScroll - 5);
  }

  function makeRow({ id, title, items, withProgress = false }) {
    const section = document.createElement("section");
    section.className = "nf-row";
    section.innerHTML = `
      <h2 class="nf-row__title">${title}</h2>
      <div class="nf-row__viewport">
        <button class="btn nf-row__arrow nf-row__arrow--left" aria-label="Scroll left" disabled>
          <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="nf-row__scroller" id="${id}"></div>
        <button class="btn nf-row__arrow nf-row__arrow--right" aria-label="Scroll right">
          <svg viewBox="0 0 24 24" width="36" height="36" class="nf-icon" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    `;
    const scroller = section.querySelector(".nf-row__scroller");
    items.forEach((item) => scroller.appendChild(createCard(item, withProgress)));

    const left  = section.querySelector(".nf-row__arrow--left");
    const right = section.querySelector(".nf-row__arrow--right");
    const scrollAmount = () => scroller.clientWidth;

    requestAnimationFrame(() => updateArrowStates(scroller, left, right));

    let scrollTimeout;
    scroller.addEventListener("scroll", () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => updateArrowStates(scroller, left, right), 50);
    });

    left.addEventListener("click", () => {
      if (!left.disabled) {
        scroller.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
        setTimeout(() => updateArrowStates(scroller, left, right), 350);
      }
    });

    right.addEventListener("click", () => {
      if (!right.disabled) {
        scroller.scrollBy({ left: scrollAmount(), behavior: "smooth" });
        setTimeout(() => updateArrowStates(scroller, left, right), 350);
      }
    });

    return section;
  }

  function refreshAllArrows() {
    document.querySelectorAll(".nf-row").forEach((row) => {
      const scroller = row.querySelector(".nf-row__scroller");
      const left = row.querySelector(".nf-row__arrow--left");
      const right = row.querySelector(".nf-row__arrow--right");
      if (scroller && left && right) updateArrowStates(scroller, left, right);
    });
  }

  function renderRows(alpha = false) {
    if (!rowsRoot) return;
    rowsRoot.innerHTML = "";
    const model = sortRowItems(rowsModel, alpha);
    model.forEach((r) => rowsRoot.appendChild(makeRow(r)));
    refreshAllArrows();
  }

  // Initial render
  renderRows(!!(alphaToggle && alphaToggle.checked));

  // Like handling
  if (rowsRoot) {
    rowsRoot.addEventListener("click", (e) => {
      const btn = e.target.closest(".like-btn");
      if (!btn) return;
      const card = btn.closest(".nf-card");
      if (!card) return;
      const id = card.dataset.itemId;
      const item = CATALOG.find((i) => i.id === id);
      if (!item) return;

      const entry = getLikeEntry(item);
      const goingLiked = !entry.liked;
      entry.liked = goingLiked;
      entry.count = Math.max(0, entry.count + (goingLiked ? 1 : -1));
      likesState[id] = entry;
      saveLikes();

      btn.classList.toggle("liked", entry.liked);
      btn.setAttribute("aria-pressed", String(entry.liked));
      const countEl = btn.querySelector(".like-count");
      if (countEl) countEl.textContent = entry.count;

      btn.classList.remove("burst");
      void btn.offsetWidth;
      btn.classList.add("burst");
    });
  }

  // --------- Search filter ---------
  const searchInput = document.getElementById("searchInput");
  function applyFilter(query) {
    const q = (query || "").trim().toLowerCase();
    document.querySelectorAll(".nf-row").forEach((row) => {
      let visibleInRow = 0;
      row.querySelectorAll(".nf-card").forEach((card) => {
        const title = card.dataset.title || "";
        const match = !q || title.includes(q);
        card.style.display = match ? "" : "none";
        if (match) visibleInRow++;
      });
      row.style.display = visibleInRow ? "" : "none";
    });
    refreshAllArrows();
  }
  if (searchInput) {
    searchInput.addEventListener("input", (e) => applyFilter(e.target.value));
  }

  // --------- A→Z toggle ---------
  if (alphaToggle) {
    alphaToggle.addEventListener("change", () => {
      renderRows(alphaToggle.checked);
      applyFilter(searchInput ? searchInput.value : "");
    });
  }

  // --------- Search box open/close UX ---------
  const searchBox = document.getElementById("searchBox");
  const searchBtn = document.getElementById("searchBtn");
  const searchField = document.getElementById("searchInput");

  function openSearch() {
    if (!searchBox) return;
    searchBox.classList.add("is-open");
    searchBox.setAttribute("aria-expanded", "true");
    if (searchField) {
      searchField.focus();
      const val = searchField.value;
      searchField.value = "";
      searchField.value = val;
    }
  }
  function closeSearch(force = false) {
    if (!searchBox) return;
    if (force || !searchField || !searchField.value.trim()) {
      searchBox.classList.remove("is-open");
      searchBox.setAttribute("aria-expanded", "false");
    }
  }
  if (searchBtn) {
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (searchBox.classList.contains("is-open")) closeSearch();
      else openSearch();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch(true);
      if (searchField) searchField.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!searchBox) return;
    const within = searchBox.contains(e.target);
    if (!within) closeSearch();
  });

  window.addEventListener("resize", refreshAllArrows);
});