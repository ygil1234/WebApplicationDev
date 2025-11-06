// JS/admin.js

(function () {
  const MODE_EXISTING = "existing";
  const MODE_NEW = "new";

  // 1. Admin-only Check
  const loggedInUser = sessionStorage.getItem("loggedInUser") || localStorage.getItem("loggedInUser"); // Accept either storage namespace when validating the admin session.
  if (loggedInUser !== "admin") {
    alert("Access Denied. You must be logged in as 'admin' to view this page.");
    window.location.href = "login.html";
    return;
  }

  // 2. Get DOM Elements
  const form = document.getElementById("contentForm");
  const submitBtn = document.getElementById("submitBtn");
  const modeSelect = document.getElementById("contentMode");
  const typeEl = document.getElementById("type");
  const typeHelpEl = document.getElementById("typeHelp");
  const extIdHelpEl = document.getElementById("extIdHelp");
  const extIdInputWrapper = document.getElementById("extIdNewGroup");
  const extIdInput = document.getElementById("extIdInput");
  const extIdSelectWrapper = document.getElementById("extIdExistingGroup");
  const extIdSelect = document.getElementById("extIdSelect");
  const extIdHidden = document.getElementById("extIdHidden");
  const extIdAutoNote = document.getElementById("extIdAutoNote");
  const clearLoadedBtn = document.getElementById("clearLoadedBtn");
  const titleEl = document.getElementById("title");
  const yearEl = document.getElementById("year");
  const genresEl = document.getElementById("genres");
  const titleHelpEl = document.getElementById("titleHelp");
  const yearHelpEl = document.getElementById("yearHelp");
  const genresHelpEl = document.getElementById("genresHelp");
  const imageFileEl = document.getElementById("imageFile");
  const imageFileHelpEl = document.getElementById("imageFileHelp");
  const videoFileEl = document.getElementById("videoFile");
  const videoFileHelpEl = document.getElementById("videoFileHelp");
  const logoutLink = document.getElementById("adminLogoutLink"); // Locate the new logout anchor in the admin footer.

  const existingDetails = document.getElementById("existingContentDetails");
  const existingCoverImg = document.getElementById("existingContentCover");
  const existingSummaryEl = document.getElementById("existingContentSummary");
  const existingMetaEl = document.getElementById("existingContentMeta");
  const existingEpisodesEl = document.getElementById("existingContentEpisodes");

  const seriesEpisodeFields = document.getElementById("seriesEpisodeFields");
  const seasonNumEl = document.getElementById("seasonNum");
  const episodeNumEl = document.getElementById("episodeNum");
  const episodeTitleEl = document.getElementById("episodeTitle");

  const successBox = document.getElementById("contentSuccess");
  const generalErr = document.getElementById("contentGeneralError");

  const { validators, attach, showError, clearError } = window.Validation; // Destructure client-side validation helpers.

  const contentSummariesCache = new Map(); // type -> array of summaries
  let summariesLoading = null;
  let loadedContent = null;
  let autoExtIdRequestId = 0;
  const defaultAutoNote = extIdAutoNote ? extIdAutoNote.textContent : ""; // Cache the default auto-assignment hint for reuse.

  if (logoutLink && !logoutLink.dataset.bound) {
    logoutLink.dataset.bound = "1"; // Avoid wiring the logout handler more than once.
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/logout", { method: "POST", credentials: "include" }); // Ask the server to terminate the current session.
      } catch (err) {
        console.warn("Logout request failed:", err); // Log (but ignore) network errors during logout.
      }
      ["loggedInUser", "selectedProfileId", "selectedProfileName", "selectedProfileAvatar"].forEach((key) => {
        localStorage.removeItem(key); // Clear persistent client state tied to the user selection.
        sessionStorage.removeItem(key); // Clear session-based storage mirrors as well.
      });
      window.location.href = "login.html"; // Return the admin to the login screen after logout.
    });
  }

  // ---------- Helpers ----------
  function getSelectedMode() {
    const value = modeSelect ? String(modeSelect.value || "") : "";
    if (value === MODE_EXISTING || value === MODE_NEW) return value;
    return "";
  }

  function getSelectedType() {
    return typeEl ? String(typeEl.value || "") : "";
  }

  function isExistingMode() {
    return getSelectedMode() === MODE_EXISTING;
  }

  function setHiddenExtId(value) {
    if (extIdHidden) {
      extIdHidden.value = value ? String(value) : "";
    }
  }

  function setAutoExtIdValue(value) {
    setHiddenExtId(value || "");
    if (!extIdInput) return;
    if (value) {
      extIdInput.value = value;
      extIdInput.placeholder = "";
    } else {
      extIdInput.value = "";
      extIdInput.placeholder = "Select a type to generate the next ID";
    }
  }

  function setAutoNoteText(text) {
    if (!extIdAutoNote) return;
    extIdAutoNote.textContent = text;
  }

  function resetEpisodeFields() {
    if (seasonNumEl) seasonNumEl.value = "";
    if (episodeNumEl) episodeNumEl.value = "";
    if (episodeTitleEl) episodeTitleEl.value = "";
  }

  function resetMetadataFields() {
    if (titleEl) titleEl.value = "";
    if (yearEl) yearEl.value = "";
    if (genresEl) genresEl.value = "";
  }

  function resetFileInputs() {
    if (imageFileEl) imageFileEl.value = "";
    if (videoFileEl) videoFileEl.value = "";
  }

  function renderLoadedContent(content) {
    const shouldShow = Boolean(content) && isExistingMode();
    if (!existingDetails) return;
    existingDetails.classList.toggle("d-none", !shouldShow);
    if (!shouldShow || !content) {
      if (existingCoverImg) {
        existingCoverImg.classList.add("d-none");
        existingCoverImg.removeAttribute("src");
      }
      if (existingSummaryEl) existingSummaryEl.textContent = "";
      if (existingMetaEl) existingMetaEl.textContent = "";
      if (existingEpisodesEl) existingEpisodesEl.innerHTML = "";
      if (clearLoadedBtn) clearLoadedBtn.classList.add("d-none");
      return;
    }

    if (clearLoadedBtn) clearLoadedBtn.classList.remove("d-none");

    const isSeries = String(content.type || "").toLowerCase() === "series";
    if (existingCoverImg) {
      const coverPath = content.cover || content.imagePath;
      if (coverPath) {
        existingCoverImg.src = coverPath;
        existingCoverImg.classList.remove("d-none");
      } else {
        existingCoverImg.classList.add("d-none");
        existingCoverImg.removeAttribute("src");
      }
    }

    if (existingSummaryEl) {
      const title = content.title || content.extId;
      const year = content.year ? ` (${content.year})` : "";
      const typeLabel = content.type ? ` - ${content.type}` : "";
      existingSummaryEl.textContent = `${title}${year}${typeLabel}`;
    }

    if (existingMetaEl) {
      const genresText = Array.isArray(content.genres) && content.genres.length
        ? content.genres.join(", ")
        : "n/a";
      const ratingText = content.rating || "n/a";
      const fileInfo = isSeries
        ? `${(content.episodes || []).length} episode${(content.episodes || []).length === 1 ? "" : "s"} stored`
        : `Movie file ${content.videoPath ? "available" : "missing"}`;
      existingMetaEl.textContent = `Genres: ${genresText} | Rating: ${ratingText} | ${fileInfo}`;
    }

    if (existingEpisodesEl) {
      existingEpisodesEl.innerHTML = "";
      if (isSeries) {
        const list = document.createElement("ul");
        list.className = "mb-0 ps-3";
        const episodes = Array.isArray(content.episodes) ? content.episodes : [];
        if (!episodes.length) {
          const li = document.createElement("li");
          li.textContent = "No episodes uploaded yet.";
          list.appendChild(li);
        } else {
          episodes.forEach((ep) => {
            const li = document.createElement("li");
            const titleSuffix = ep.title ? ` - ${ep.title}` : "";
            li.textContent = `S${ep.season}E${ep.episode}${titleSuffix}`;
            list.appendChild(li);
          });
        }
        existingEpisodesEl.appendChild(list);
      } else {
        const p = document.createElement("p");
        p.className = "mb-0";
        p.textContent = content.videoPath
          ? "A movie file is already stored for this title."
          : "No movie file stored yet. Upload a new one if needed.";
        existingEpisodesEl.appendChild(p);
      }
    }
  }

  function clearLoadedContent(options = {}) {
    const { resetMetadata = false, keepExtId = false } = options;
    loadedContent = null;
    if (!keepExtId) {
      if (extIdSelect) {
        extIdSelect.value = "";
      }
      setHiddenExtId("");
    }
    if (resetMetadata) {
      resetMetadataFields();
    }
    renderLoadedContent(null);
    if (clearLoadedBtn) clearLoadedBtn.classList.add("d-none");
  }

  function populateFormFromContent(content, { preserveExtId = false } = {}) {
    if (!content) return;
    if (!preserveExtId) {
      if (extIdSelect) extIdSelect.value = content.extId;
      setHiddenExtId(content.extId);
    }
    if (titleEl) titleEl.value = content.title || "";
    if (yearEl) yearEl.value = content.year ? String(content.year) : "";
    if (genresEl) {
      if (Array.isArray(content.genres) && content.genres.length) {
        genresEl.value = content.genres.join(", ");
      } else {
        genresEl.value = content.genres ? String(content.genres) : "";
      }
    }
    if (typeEl && content.type) {
      typeEl.value = content.type;
    }
    syncEpisodeVisibility();
  }

  function updateMetadataHelps() {
    const mode = getSelectedMode();
    const suffix = mode === MODE_EXISTING
      ? "Loaded entries are pre-filled; adjust if you want to change details."
      : "These fields are required for every new title.";
    if (titleHelpEl) titleHelpEl.textContent = `Provide the on-screen title. ${suffix}`;
    if (yearHelpEl) yearHelpEl.textContent = `Enter the release year. ${suffix}`;
    if (genresHelpEl) genresHelpEl.textContent = `List one or more genres separated by commas. ${suffix}`;
  }

  function updateMediaHelps() {
    const mode = getSelectedMode();
    const type = getSelectedType();
    const isExisting = mode === MODE_EXISTING;
    const isSeries = type === "Series";
    const isMovie = type === "Movie";

    if (imageFileHelpEl) {
      let text = "Upload a cover to accompany this title.";
      if (mode === MODE_NEW) {
        text = isSeries
          ? "Required when creating a new series so viewers can find it."
          : "Required when creating a new movie.";
      } else if (isExisting) {
        text = isSeries
          ? "Optional: upload to replace the current series cover."
          : "Optional: upload to replace the current movie cover.";
      }
      imageFileHelpEl.textContent = text;
    }

    if (videoFileHelpEl) {
      let text = "Attach a video when needed for this action.";
      if (mode === MODE_NEW) {
        text = isMovie
          ? "Required for new movies so the full video is available."
          : "Optional. Combine with season/episode numbers to upload the first episode.";
      } else if (isExisting && isSeries) {
        text = "Provide a video along with season/episode numbers to upload a new episode.";
      } else if (isExisting && isMovie) {
        text = "Optional: attach to replace the stored movie file.";
      }
      videoFileHelpEl.textContent = text;
    }
  }

  function syncEpisodeVisibility() {
    if (!seriesEpisodeFields) return;
    const isSeries = getSelectedType() === "Series";
    seriesEpisodeFields.classList.toggle("d-none", !isSeries);
  }

  function clearFieldErrors() {
    [
      modeSelect,
      typeEl,
      titleEl,
      yearEl,
      genresEl,
      extIdInput,
      extIdSelect,
      imageFileEl,
      videoFileEl,
      seasonNumEl,
      episodeNumEl,
    ].forEach((el) => {
      if (el) clearError(el);
    });
  }

  function ensurePlaceholderOption(selectEl, text) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = text;
    selectEl.appendChild(opt);
  }

  async function fetchContentSummaries(type) {
    const cacheKey = type || "__all__";
    if (contentSummariesCache.has(cacheKey)) {
      return contentSummariesCache.get(cacheKey);
    }
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    const res = await fetch(`/api/admin/content${qs}`, { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error || `Failed to load content (HTTP ${res.status})`);
    }
    const list = Array.isArray(body.data) ? body.data : [];
    contentSummariesCache.set(cacheKey, list);
    return list;
  }

  async function populateExistingOptions() {
    if (!extIdSelect) return;
    const type = getSelectedType();
    if (!isExistingMode()) {
      ensurePlaceholderOption(extIdSelect, "Switch to step 1 to choose an existing title.");
      extIdSelect.disabled = true;
      return;
    }
    if (!type) {
      ensurePlaceholderOption(extIdSelect, "Choose a type to see existing titles.");
      extIdSelect.disabled = true;
      return;
    }

    ensurePlaceholderOption(extIdSelect, "Loading titles…");
    extIdSelect.disabled = true;
    try {
      summariesLoading = fetchContentSummaries(type);
      const summaries = await summariesLoading;
      summariesLoading = null;
      ensurePlaceholderOption(
        extIdSelect,
        summaries.length ? "Select an existing title..." : `No ${type.toLowerCase()}s found.`,
      );
      summaries.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.extId;
        option.textContent = `${item.title || item.extId} (${item.extId})`;
        extIdSelect.appendChild(option);
      });
      extIdSelect.disabled = summaries.length === 0;
      if (loadedContent && loadedContent.type === type) {
        extIdSelect.value = loadedContent.extId;
      }
    } catch (err) {
      console.error("populateExistingOptions error:", err);
      ensurePlaceholderOption(extIdSelect, "Unable to load titles. Try again later.");
      extIdSelect.disabled = true;
      if (generalErr) {
        generalErr.classList.remove("d-none");
        generalErr.textContent = "Unable to load existing titles. Please refresh and try again.";
      }
    }
  }

  async function refreshAutoExtId() {
    if (getSelectedMode() !== MODE_NEW) return null;
    if (!extIdInput) return null;
    const type = getSelectedType();
    if (!type) {
      setAutoExtIdValue("");
      extIdInput.placeholder = "Select a type to generate the next ID";
      setAutoNoteText(defaultAutoNote);
      return null;
    }

    const requestId = ++autoExtIdRequestId;
    extIdInput.placeholder = "";
    extIdInput.value = "Generating next ID…";
    setAutoExtIdValue("");
    setAutoNoteText("Calculating the next available ID...");
    try {
      const summaries = await fetchContentSummaries(type);
      if (requestId !== autoExtIdRequestId) return null;
      const prefix = type === "Movie" ? "m" : "s";
      const regex = prefix === "m" ? /^m(\d+)$/i : /^s(\d+)$/i;
      let maxNum = 0;
      summaries.forEach((item) => {
        const match = regex.exec(String(item.extId || ""));
        if (!match) return;
        const num = Number.parseInt(match[1], 10);
        if (Number.isFinite(num)) {
          maxNum = Math.max(maxNum, num);
        }
      });
      const nextValue = `${prefix}${maxNum + 1}`;
      setAutoExtIdValue(nextValue);
      extIdInput.placeholder = "";
      setAutoNoteText(defaultAutoNote);
      clearError(extIdInput);
      return nextValue;
    } catch (err) {
      if (requestId !== autoExtIdRequestId) return null;
      console.error("refreshAutoExtId error:", err);
      setAutoExtIdValue("");
      extIdInput.value = "";
      extIdInput.placeholder = "Unable to generate ID";
      setAutoNoteText("Unable to generate the next ID. Please try again.");
      return null;
    }
  }

  async function loadExistingContent(extId, options = {}) {
    const { silent = false } = options;
    const trimmed = String(extId || "").trim();
    if (!trimmed) {
      if (!silent && extIdSelect) {
        showError(extIdSelect, "Select an existing External ID.");
      }
      return null;
    }
    if (!isExistingMode()) {
      return null;
    }
    clearError(extIdSelect);
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(trimmed)}`, {
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent && extIdSelect) {
          showError(extIdSelect, body?.error || "Unable to load that ID.");
        }
        clearLoadedContent({ resetMetadata: true, keepExtId: true });
        return null;
      }
      const content = body.data;
      const docType = String(content.type || "");
      if (typeEl) {
        const current = getSelectedType();
        if (!current) {
          typeEl.value = docType;
        } else if (current !== docType) {
          showError(typeEl, `Loaded content is tagged as ${docType}. Match the type to proceed.`);
          clearLoadedContent({ keepExtId: true });
          return null;
        }
        clearError(typeEl);
      }
      loadedContent = content;
      setHiddenExtId(content.extId);
      populateFormFromContent(content, { preserveExtId: true });
      renderLoadedContent(content);
      updateMetadataHelps();
      updateMediaHelps();
      return content;
    } catch (err) {
      console.error("loadExistingContent error:", err);
      if (!silent && generalErr) {
        generalErr.classList.remove("d-none");
        generalErr.textContent = "Could not load content. Please try again.";
      }
      return null;
    }
  }

  function updateExtIdUI() {
    const mode = getSelectedMode();
    const isExisting = mode === MODE_EXISTING;
    if (extIdInputWrapper) extIdInputWrapper.classList.toggle("d-none", isExisting);
    if (extIdSelectWrapper) extIdSelectWrapper.classList.toggle("d-none", !isExisting);
    if (!isExisting) {
      if (extIdSelect) extIdSelect.value = "";
      if (clearLoadedBtn) clearLoadedBtn.classList.add("d-none");
      renderLoadedContent(null);
      loadedContent = null;
    } else {
      setAutoExtIdValue("");
      setAutoNoteText(defaultAutoNote);
    }
  }

  function updateModeUI() {
    const mode = getSelectedMode();
    const hasMode = mode === MODE_EXISTING || mode === MODE_NEW;

    if (!hasMode && typeEl) {
      typeEl.value = "";
      typeEl.disabled = true;
    } else if (typeEl) {
      typeEl.disabled = false;
    }

    if (typeHelpEl) {
      typeHelpEl.textContent = hasMode
        ? "Select whether this content is a movie or a series."
        : "Choose a mode above to enable this step.";
    }

    if (extIdHelpEl) {
      extIdHelpEl.textContent = mode === MODE_EXISTING
        ? "Select the existing External ID to automatically load its details."
        : "The External ID is assigned automatically for new titles.";
    }

    updateExtIdUI();
    updateMetadataHelps();
    updateMediaHelps();
    syncEpisodeVisibility();

    if (mode === MODE_EXISTING) {
      setHiddenExtId(extIdSelect ? extIdSelect.value : "");
      populateExistingOptions();
    } else if (mode === MODE_NEW) {
      clearLoadedContent({ keepExtId: true });
      refreshAutoExtId();
    } else {
      setHiddenExtId("");
      clearLoadedContent({ keepExtId: false });
      ensurePlaceholderOption(extIdSelect, "Select step 1 to see existing titles.");
      if (extIdSelect) extIdSelect.disabled = true;
    }
  }

  function validateExtIdField() {
    const mode = getSelectedMode();
    if (mode === MODE_EXISTING) {
      if (!extIdSelect) return null;
      const value = String(extIdSelect.value || "").trim();
      clearError(extIdSelect);
      if (!value) {
        showError(extIdSelect, "Select an existing External ID.");
        return null;
      }
      setHiddenExtId(value);
      return value;
    }
    if (mode === MODE_NEW) {
      const value = resolveExtIdValue();
      if (extIdInput) clearError(extIdInput);
      if (!value) {
        refreshAutoExtId();
        if (extIdInput) {
          showError(extIdInput, "Unable to generate an External ID. Try selecting the type again.");
        }
        return null;
      }
      return value;
    }
    if (modeSelect) showError(modeSelect, "Select whether the title already exists.");
    return null;
  }

  function resolveExtIdValue() {
    return extIdHidden ? extIdHidden.value.trim() : "";
  }

  // ---------- Event wiring ----------
  if (!form || !modeSelect || !typeEl || !titleEl || !yearEl || !genresEl) {
    console.error("Admin form is missing required elements.");
    return;
  }

  modeSelect.addEventListener("change", () => {
    clearError(modeSelect);
    updateModeUI();
    resetEpisodeFields();
    resetFileInputs();
  });

  typeEl.addEventListener("change", () => {
    clearError(typeEl);
    syncEpisodeVisibility();
    updateMediaHelps();
    if (isExistingMode()) {
      clearLoadedContent({ keepExtId: true });
      populateExistingOptions();
    } else if (getSelectedMode() === MODE_NEW) {
      refreshAutoExtId();
    }
  });

  if (extIdSelect) {
    extIdSelect.addEventListener("change", () => {
      clearError(extIdSelect);
      const val = extIdSelect.value;
      setHiddenExtId(val);
      if (val) {
        loadExistingContent(val, { silent: false });
      } else {
        clearLoadedContent({ keepExtId: true });
      }
    });
  }

  if (clearLoadedBtn) {
    clearLoadedBtn.addEventListener("click", () => {
      if (extIdSelect) extIdSelect.value = "";
      setHiddenExtId("");
      clearLoadedContent({ resetMetadata: true });
      resetEpisodeFields();
      resetFileInputs();
      if (extIdSelect && !extIdSelect.disabled) extIdSelect.focus();
    });
  }

  if (seasonNumEl) {
    seasonNumEl.addEventListener("input", () => clearError(seasonNumEl));
  }
  if (episodeNumEl) {
    episodeNumEl.addEventListener("input", () => clearError(episodeNumEl));
  }
  if (imageFileEl) {
    imageFileEl.addEventListener("change", () => {
      clearError(imageFileEl); // Remove any previous validation message before re-checking.
      const file = imageFileEl.files?.[0];
      if (!file) return;
      const allowedTypes = ["image/jpeg", "image/png"]; // List the image MIME types the backend accepts.
      if (!allowedTypes.includes(file.type)) {
        imageFileEl.value = ""; // Reset the file input so an invalid file is not submitted.
        showError(imageFileEl, "Unsupported image file. Please upload a JPG or PNG."); // Explain the allowed formats to the admin.
      }
    });
  }
  if (videoFileEl) {
    videoFileEl.addEventListener("change", () => {
      clearError(videoFileEl); // Remove any previous validation message before re-checking.
      const file = videoFileEl.files?.[0];
      if (!file) return;
      const allowedTypes = ["video/mp4"]; // Restrict video uploads to the MP4 format handled on the server.
      if (!allowedTypes.includes(file.type)) {
        videoFileEl.value = ""; // Reset the selected file so it cannot be submitted accidentally.
        showError(videoFileEl, "Unsupported video file. Please upload an MP4 video."); // Tell the admin which format is required.
      }
    });
  }

  // ---------- Validation + Submit ----------
  attach(
    form,
    [
      { el: modeSelect, rules: [{ test: (val) => val === MODE_EXISTING || val === MODE_NEW, message: "Please choose whether the title already exists." }] },
      { el: typeEl, rules: [{ test: (val) => val === "Movie" || val === "Series", message: "Please select a type." }] },
      { el: titleEl, rules: [{ test: validators.minLength(1), message: "Title is required." }] },
      {
        el: yearEl,
        rules: [
          {
            test: (val) => /^\d{4}$/.test(val) && +val > 1880 && +val < 2100,
            message: "Must be a valid 4-digit year.",
          },
        ],
      },
      { el: genresEl, rules: [{ test: validators.minLength(1), message: "At least one genre is required." }] },
    ],
    async () => {
      [successBox, generalErr].forEach((box) => {
        if (!box) return;
        box.classList.add("d-none");
        box.textContent = "";
      });
      clearFieldErrors();

      const mode = getSelectedMode();
      const typeValue = getSelectedType();
      const isExisting = mode === MODE_EXISTING;
      const isSeries = typeValue === "Series";
      const isMovie = typeValue === "Movie";

      const extIdValue = validateExtIdField();
      if (!extIdValue) return;

      if (isExisting && !loadedContent) {
        showError(extIdSelect, "Select an existing title to load before submitting.");
        return;
      }

      const seasonVal = Number(seasonNumEl?.value || 0);
      const episodeVal = Number(episodeNumEl?.value || 0);
      const hasSeason = Number.isFinite(seasonVal) && seasonVal > 0;
      const hasEpisode = Number.isFinite(episodeVal) && episodeVal > 0;
      const hasEpisodeNumbers = hasSeason && hasEpisode;
      const hasEpisodeVideo = videoFileEl && videoFileEl.files.length > 0;

      if (mode === MODE_NEW) {
        if (imageFileEl && imageFileEl.files.length === 0) {
          showError(imageFileEl, isSeries ? "Cover image is required for new series." : "Cover image is required for new movies.");
          return;
        }
        if (isMovie && (!videoFileEl || videoFileEl.files.length === 0)) {
          showError(videoFileEl, "Upload the movie file (MP4) when creating a new movie.");
          return;
        }
      }

      if (isSeries) {
        if (hasEpisodeNumbers && !hasEpisodeVideo) {
          showError(videoFileEl, "Select the episode video file to upload.");
          return;
        }
        if (hasEpisodeVideo && !hasEpisodeNumbers) {
          showError(seasonNumEl, "Provide both season and episode numbers.");
          showError(episodeNumEl, "Provide both season and episode numbers.");
          return;
        }
      }

      const contentData = new FormData();
      contentData.append("extId", extIdValue);
      contentData.append("title", titleEl.value.trim());
      contentData.append("year", yearEl.value.trim());
      contentData.append("genres", genresEl.value.trim());
      contentData.append("type", typeValue);

      if (imageFileEl && imageFileEl.files.length > 0) {
        contentData.append("imageFile", imageFileEl.files[0]);
      }
      if (videoFileEl && videoFileEl.files.length > 0 && !isSeries) {
        contentData.append("videoFile", videoFileEl.files[0]);
      }

      const prevBtnText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = "Uploading... (This may take a moment)";

      try {
        const response = await fetch("/api/admin/content", {
          method: "POST",
          body: contentData,
          credentials: "include",
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const msg = `[${response.status}] ${data?.error || "Unable to submit content."}`;
          if (generalErr) {
            generalErr.classList.remove("d-none");
            generalErr.textContent = msg;
          }
          return;
        }

        let message = `Success! Content '${data.data.title}' was ${response.status === 201 ? "created" : "updated"}.`;
        if (data.data.rating) {
          message += ` Rating: ${data.data.rating}`;
        }

        if (typeValue) {
          contentSummariesCache.delete(typeValue);
          contentSummariesCache.delete("__all__");
        }

        if (isSeries && hasEpisodeNumbers && hasEpisodeVideo) {
          try {
            const epData = new FormData();
            epData.append("seriesExtId", extIdValue);
            epData.append("season", String(seasonVal));
            epData.append("episode", String(episodeVal));
            epData.append("title", String(episodeTitleEl?.value || ""));
            epData.append("videoFile", videoFileEl.files[0]);

            const epResponse = await fetch("/api/admin/episodes", {
              method: "POST",
              body: epData,
              credentials: "include",
            });
            const epJson = await epResponse.json().catch(() => ({}));
            if (!epResponse.ok) {
              throw new Error(epJson?.error || `Episode upload failed (HTTP ${epResponse.status})`);
            }
            const s = epJson?.episode?.season ?? seasonVal;
            const e = epJson?.episode?.episode ?? episodeVal;
            message += ` Episode uploaded: S${s}E${e}.`;
          } catch (episodeError) {
            if (generalErr) {
              generalErr.classList.remove("d-none");
              generalErr.textContent = String(episodeError?.message || "Episode upload failed.");
            }
          }
        }

        if (successBox) {
          successBox.classList.remove("d-none");
          successBox.textContent = message;
        }

        resetFileInputs();
        resetEpisodeFields();

        if (isExistingMode()) {
          const extId = resolveExtIdValue();
          await loadExistingContent(extId, { silent: true });
          await populateExistingOptions();
          if (extIdSelect) extIdSelect.value = extId;
        } else {
          form.reset();
          setHiddenExtId("");
          updateModeUI();
        }
      } catch (err) {
        console.error("submit content error:", err);
        if (generalErr) {
          generalErr.classList.remove("d-none");
          generalErr.textContent = "Server unreachable or upload failed. Is the file too large?";
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = prevBtnText;
        updateMediaHelps();
      }
    }
  );

  // Initial UI sync
  ensurePlaceholderOption(extIdSelect, "Select step 1 to see existing titles.");
  if (extIdSelect) extIdSelect.disabled = true;
  updateModeUI();
})();
