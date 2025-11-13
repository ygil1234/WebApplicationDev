// JS/admin.js

(function () {
  const MODE_EXISTING = "existing";
  const MODE_NEW = "new";
  const MODE_DELETE = "delete"; // New mode for delete functionality

  // 1. Admin-only Check
  const loggedInUser = sessionStorage.getItem("loggedInUser") || localStorage.getItem("loggedInUser");
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
  const extIdInputWrapper = document.getElementById("extIdNewGroup");
  const extIdInput = document.getElementById("extIdInput");
  const extIdSelectWrapper = document.getElementById("extIdExistingGroup");
  const extIdSelect = document.getElementById("extIdSelect");
  const extIdHidden = document.getElementById("extIdHidden");
  
  // Metadata fields container (hidden in delete mode)
  const metadataFields = document.getElementById("metadataFields");
  const titleEl = document.getElementById("title");
  const yearEl = document.getElementById("year");
  const genresEl = document.getElementById("genres");
  const imageFileEl = document.getElementById("imageFile");
  const videoFileEl = document.getElementById("videoFile");
  
  const logoutLink = document.getElementById("adminLogoutLink");

  // Existing content display elements
  const existingDetails = document.getElementById("existingContentDetails");
  const existingCoverImg = document.getElementById("existingContentCover");
  const existingSummaryEl = document.getElementById("existingContentSummary");
  const existingMetaEl = document.getElementById("existingContentMeta");
  const existingEpisodesEl = document.getElementById("existingContentEpisodes");

  // Delete confirmation section
  const deleteConfirmSection = document.getElementById("deleteConfirmSection");
  const deleteConfirmTitle = document.getElementById("deleteConfirmTitle");
  const deleteConfirmMeta = document.getElementById("deleteConfirmMeta");

  const seriesEpisodeFields = document.getElementById("seriesEpisodeFields");
  const seasonNumEl = document.getElementById("seasonNum");
  const episodeNumEl = document.getElementById("episodeNum");
  const episodeTitleEl = document.getElementById("episodeTitle");

  const successBox = document.getElementById("contentSuccess");
  const generalErr = document.getElementById("contentGeneralError");
  let successHideTimer = null;

  const { validators, attach, showError, clearError } = window.Validation; // Shared client-side validation helpers.

  const contentSummariesCache = new Map();
  let summariesLoading = null;
  let loadedContent = null;
  let autoExtIdRequestId = 0;

  // Logout handler
  if (logoutLink && !logoutLink.dataset.bound) {
    logoutLink.dataset.bound = "1";
    logoutLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/logout", { method: "POST", credentials: "include" });
      } catch (err) {
        console.warn("Logout request failed:", err);
      }
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace("login.html");
    });
  }

  // ---------- Helper Functions ----------
  
  function getSelectedMode() { // Normalize the dropdown selection into one of our known modes.
    const value = modeSelect ? String(modeSelect.value || "") : "";
    if (value === MODE_EXISTING || value === MODE_NEW || value === MODE_DELETE) return value;
    return "";
  }

  function getSelectedType() {
    return typeEl ? String(typeEl.value || "") : "";
  }

  function isExistingMode() {
    return getSelectedMode() === MODE_EXISTING;
  }

  function isDeleteMode() {
    return getSelectedMode() === MODE_DELETE;
  }

  function setHiddenExtId(value) {
    if (extIdHidden) {
      extIdHidden.value = value ? String(value) : "";
    }
  }

  function setAutoExtIdValue(value) { // Mirror the generated extId into a hidden field so submit logic can read it uniformly.
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

  function resetEpisodeFields() { // Ensure stale episode inputs never bleed into new submissions.
    if (seasonNumEl) seasonNumEl.value = "";
    if (episodeNumEl) episodeNumEl.value = "";
    if (episodeTitleEl) episodeTitleEl.value = "";
  }

  function resetMetadataFields() { // Quickly clear high-level metadata when switching targets.
    if (titleEl) titleEl.value = "";
    if (yearEl) yearEl.value = "";
    if (genresEl) genresEl.value = "";
  }

  function resetFileInputs() { // Dropping the file input prevents accidental re-uploads after a mode change.
    if (imageFileEl) imageFileEl.value = "";
    if (videoFileEl) videoFileEl.value = "";
  }

  function resetFormForModeChange(nextMode) { // Used when switching actions so every control snaps back to the default state.
    if (!form) return;
    form.reset();
    setHiddenExtId("");
    resetMetadataFields();
    resetEpisodeFields();
    resetFileInputs();
    loadedContent = null;
    renderLoadedContent(null);
    updateDeleteConfirmation();
    if (extIdSelect) {
      extIdSelect.value = "";
      clearError(extIdSelect);
    }
    if (modeSelect) modeSelect.value = nextMode || "";
    if (successBox) successBox.classList.add("d-none");
    if (generalErr) generalErr.classList.add("d-none");
  }

  function showSuccessMessage(text) { // Centralized toast so every flow behaves consistently when operations succeed.
    if (!successBox) return;
    successBox.textContent = text || "";
    successBox.classList.remove("d-none");
    if (successHideTimer) clearTimeout(successHideTimer);
    successHideTimer = setTimeout(() => {
      successBox.classList.add("d-none");
      successBox.textContent = "";
      successHideTimer = null;
    }, 3000);
  }

  // Update submit button based on current mode
  function updateSubmitButton() {
    if (!submitBtn) return;
    const mode = getSelectedMode();
    
    if (mode === MODE_DELETE) {
      submitBtn.textContent = "Delete Content";
      submitBtn.className = "btn btn-danger"; // Red button for delete
    } else {
      submitBtn.textContent = "Submit Content";
      submitBtn.className = "btn btn-nf-primary"; // Netflix primary button
    }
  }

  // Show/hide delete confirmation section
  function updateDeleteConfirmation() { // Keeps the warning card in sync with whatever record is queued for removal.
    if (!deleteConfirmSection) return;
    
    const showConfirm = isDeleteMode() && loadedContent;
    deleteConfirmSection.classList.toggle("d-none", !showConfirm);
    
    if (showConfirm && loadedContent) {
      if (deleteConfirmTitle) {
        deleteConfirmTitle.textContent = `${loadedContent.title} (${loadedContent.extId})`;
      }
      if (deleteConfirmMeta) {
        const year = loadedContent.year ? `${loadedContent.year}` : "";
        const type = loadedContent.type || "";
        const genres = Array.isArray(loadedContent.genres) ? loadedContent.genres.join(", ") : "";
        deleteConfirmMeta.textContent = `${type} ${year ? `• ${year}` : ""} ${genres ? `• ${genres}` : ""}`.trim();
      }
    }
  }

  // Render loaded content details (used for existing and delete modes)
  function renderLoadedContent(content) { // Mirrors backend data into the preview card so admin know what he is editing.
    const shouldShow = Boolean(content) && (isExistingMode() || isDeleteMode());
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
      return;
    }

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

  function clearLoadedContent(options = {}) { // Drop cached doc + UI state whenever the selection becomes invalid.
    const { resetMetadata = false, keepExtId = false } = options;
    loadedContent = null;
    if (!keepExtId) {
      if (extIdSelect) extIdSelect.value = "";
      setHiddenExtId("");
    }
    if (resetMetadata) {
      resetMetadataFields();
    }
    renderLoadedContent(null);
    updateDeleteConfirmation();
  }

  function populateFormFromContent(content, { preserveExtId = false } = {}) { // Pre-fill form fields so edits start from the current DB values.
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

  function syncEpisodeVisibility() {
    if (!seriesEpisodeFields) return;
    const isSeries = getSelectedType() === "Series";
    const shouldShow = isSeries && !isDeleteMode(); // Hide in delete mode
    seriesEpisodeFields.classList.toggle("d-none", !shouldShow);
  }

  // Show/hide metadata fields based on mode
  function syncMetadataFieldsVisibility() { // Delete mode hides every field that isn't required for confirmation.
    if (!metadataFields) return;
    const shouldHide = isDeleteMode(); // Hide all metadata fields in delete mode
    metadataFields.classList.toggle("d-none", shouldHide);
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

  function ensurePlaceholderOption(selectEl, text) { // Rebuild the select so stale options can't linger after cache clears.
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
    const mode = getSelectedMode();
    
    // Show dropdown for existing or delete modes
    if (mode !== MODE_EXISTING && mode !== MODE_DELETE) {
      ensurePlaceholderOption(extIdSelect, "Switch to update or delete mode to choose an existing title.");
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
      return null;
    }

    const requestId = ++autoExtIdRequestId; // Track the latest async request so older responses can be ignored.
    extIdInput.placeholder = "";
    extIdInput.value = "Generating next ID…";
    setAutoExtIdValue("");
    
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
      clearError(extIdInput);
      return nextValue;
    } catch (err) {
      if (requestId !== autoExtIdRequestId) return null;
      console.error("refreshAutoExtId error:", err);
      setAutoExtIdValue("");
      extIdInput.value = "";
      extIdInput.placeholder = "Unable to generate ID";
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
    
    const mode = getSelectedMode();
    if (mode !== MODE_EXISTING && mode !== MODE_DELETE) {
      return null;
    }
    
    clearError(extIdSelect);
    
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(trimmed)}`, { // Pull the latest copy so edits always use server truth.
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
      
      // Only populate form fields if NOT in delete mode
      if (!isDeleteMode()) {
        populateFormFromContent(content, { preserveExtId: true });
      }
      
      renderLoadedContent(content);
      updateDeleteConfirmation();
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
    const isDelete = mode === MODE_DELETE;
    const showDropdown = isExisting || isDelete;
    
    if (extIdInputWrapper) extIdInputWrapper.classList.toggle("d-none", showDropdown);
    if (extIdSelectWrapper) extIdSelectWrapper.classList.toggle("d-none", !showDropdown);
    
    if (!showDropdown) {
      if (extIdSelect) extIdSelect.value = "";
      renderLoadedContent(null);
      loadedContent = null;
    } else {
      setAutoExtIdValue("");
    }
    
    updateDeleteConfirmation();
  }

  function updateModeUI() { // Primary orchestrator that toggles every section based on the selected action.
    const mode = getSelectedMode();
    const hasMode = mode === MODE_EXISTING || mode === MODE_NEW || mode === MODE_DELETE;

    if (!hasMode && typeEl) {
      typeEl.value = "";
      typeEl.disabled = true;
    } else if (typeEl) {
      typeEl.disabled = false;
    }

    updateExtIdUI();
    syncEpisodeVisibility();
    syncMetadataFieldsVisibility();
    updateSubmitButton();

    if (mode === MODE_EXISTING) {
      setHiddenExtId(extIdSelect ? extIdSelect.value : "");
      populateExistingOptions();
    } else if (mode === MODE_NEW) {
      clearLoadedContent({ keepExtId: true });
      refreshAutoExtId();
    } else if (mode === MODE_DELETE) {
      clearLoadedContent({ keepExtId: true });
      populateExistingOptions();
    } else {
      setHiddenExtId("");
      clearLoadedContent({ keepExtId: false });
      ensurePlaceholderOption(extIdSelect, "Select a mode to see existing titles.");
      if (extIdSelect) extIdSelect.disabled = true;
    }
  }

  function validateExtIdField() {
    const mode = getSelectedMode();
    
    if (mode === MODE_EXISTING || mode === MODE_DELETE) {
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
    
    if (modeSelect) showError(modeSelect, "Select an action mode.");
    return null;
  }

  function resolveExtIdValue() {
    return extIdHidden ? extIdHidden.value.trim() : "";
  }

  // ---------- Event Wiring ----------
  
  if (!form || !modeSelect || !typeEl || !titleEl || !yearEl || !genresEl) {
    console.error("Admin form is missing required elements.");
    return;
  }

  modeSelect.addEventListener("change", () => {
    const nextMode = modeSelect.value;
    resetFormForModeChange(nextMode);
    clearError(modeSelect);
    updateModeUI();
  });

  typeEl.addEventListener("change", () => {
    clearError(typeEl);
    syncEpisodeVisibility();
    
    const mode = getSelectedMode();
    if (mode === MODE_EXISTING || mode === MODE_DELETE) {
      clearLoadedContent({ keepExtId: true });
      populateExistingOptions();
    } else if (mode === MODE_NEW) {
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

  if (seasonNumEl) {
    seasonNumEl.addEventListener("input", () => clearError(seasonNumEl));
  }
  if (episodeNumEl) {
    episodeNumEl.addEventListener("input", () => clearError(episodeNumEl));
  }
  
  if (imageFileEl) {
    imageFileEl.addEventListener("change", () => {
      clearError(imageFileEl);
      const file = imageFileEl.files?.[0];
      if (!file) return;
      const allowedTypes = ["image/jpeg", "image/png"];
      if (!allowedTypes.includes(file.type)) {
        imageFileEl.value = "";
        showError(imageFileEl, "Unsupported image file. Please upload a JPG or PNG.");
      }
    });
  }
  
  if (videoFileEl) {
    videoFileEl.addEventListener("change", () => {
      clearError(videoFileEl);
      const file = videoFileEl.files?.[0];
      if (!file) return;
      const allowedTypes = ["video/mp4"];
      if (!allowedTypes.includes(file.type)) {
        videoFileEl.value = "";
        showError(videoFileEl, "Unsupported video file. Please upload an MP4 video.");
      }
    });
  }

  // ---------- Form Submission ----------
  
  attach( // Reuse the shared validator but relax rules automatically in delete mode.
    form,
    [
      { 
        el: modeSelect, 
        rules: [{ 
          test: (val) => val === MODE_EXISTING || val === MODE_NEW || val === MODE_DELETE, 
          message: "Please choose an action mode." 
        }] 
      },
      { 
        el: typeEl, 
        rules: [{ 
          test: (val) => val === "Movie" || val === "Series", 
          message: "Please select a type." 
        }] 
      },
      // Title, year, genres only required for non-delete modes
      { 
        el: titleEl, 
        rules: [{ 
          test: (val) => isDeleteMode() || validators.minLength(1)(val), 
          message: "Title is required." 
        }] 
      },
      {
        el: yearEl,
        rules: [
          {
            test: (val) => isDeleteMode() || (/^\d{4}$/.test(val) && +val > 1880 && +val < 2100),
            message: "Must be a valid 4-digit year.",
          },
        ],
      },
      { 
        el: genresEl, 
        rules: [{ 
          test: (val) => isDeleteMode() || validators.minLength(1)(val), 
          message: "At least one genre is required." 
        }] 
      },
    ],
    async () => {
      // Clear previous messages
      [successBox, generalErr].forEach((box) => {
        if (!box) return;
        box.classList.add("d-none");
        box.textContent = "";
      });
      clearFieldErrors();

      const mode = getSelectedMode();
      const typeValue = getSelectedType();
      const isSeries = typeValue === "Series";
      const isMovie = typeValue === "Movie";

      const extIdValue = validateExtIdField();
      if (!extIdValue) return;

      // Handle DELETE mode
      if (mode === MODE_DELETE) {
        if (!loadedContent) {
          showError(extIdSelect, "Select an existing title to delete.");
          return;
        }

        const prevBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Deleting...";

        try {
          const payload = {
            type: typeValue,
            extId: extIdValue
          };

          const response = await fetch("/api/admin/content", { // API already enforces admin auth, so we only send the identifiers.
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          });
          
          const data = await response.json().catch(() => ({}));
          
          if (!response.ok) {
            const msg = `[${response.status}] ${data?.error || "Unable to delete content."}`;
            if (generalErr) {
              generalErr.classList.remove("d-none");
              generalErr.textContent = msg;
            }
            return;
          }

          // Clear cache
          contentSummariesCache.delete(typeValue);
          contentSummariesCache.delete("__all__");
          
          // Reset form
          form.reset();
          clearLoadedContent({ resetMetadata: true });
          updateModeUI();

          const deletedTitle = data?.data?.title || data?.data?.extId || "Selected content";
          const deletedExtId = data?.data?.extId ? ` (${data.data.extId})` : "";
          showSuccessMessage(`Successfully deleted '${deletedTitle}'${deletedExtId}.`);
        } catch (err) {
          console.error("delete content error:", err);
          if (generalErr) {
            generalErr.classList.remove("d-none");
            generalErr.textContent = "Unable to delete content right now.";
          }
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = prevBtnText;
        }
        
        return; // Exit early for delete mode
      }

      // Handle ADD/UPDATE modes (existing code)
      const isExisting = mode === MODE_EXISTING;

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

        showSuccessMessage(message);

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
          generalErr.textContent = "Server unreachable or upload failed. Is the file too large?";//default Express limits around 100 KB unless increased
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = prevBtnText;
      }
    }
  );

  // Initial UI sync
  ensurePlaceholderOption(extIdSelect, "Select a mode to see existing titles.");
  if (extIdSelect) extIdSelect.disabled = true;
  updateModeUI();
})();
