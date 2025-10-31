// JS/admin.js

(function () {
    // 1. Admin-only Check
    const loggedInUser = localStorage.getItem("loggedInUser");
    if (loggedInUser !== "admin") {
      alert("Access Denied. You must be logged in as 'admin' to view this page.");
      window.location.href = "login.html"; 
      return; 
    }
  
    // 2. Get DOM Elements
    const form = document.getElementById("contentForm");
    const submitBtn = document.getElementById("submitBtn");
    const extIdEl = document.getElementById("extId");
    const titleEl = document.getElementById("title");
    const yearEl = document.getElementById("year");
    const genresEl = document.getElementById("genres");
    const typeEl = document.getElementById("type");
    const imageFileEl = document.getElementById("imageFile"); 
    const videoFileEl = document.getElementById("videoFile"); 
    // Optional episode fields for Series
    const seriesEpisodeFields = document.getElementById("seriesEpisodeFields");
    const seasonNumEl = document.getElementById("seasonNum");
    const episodeNumEl = document.getElementById("episodeNum");
    const episodeTitleEl = document.getElementById("episodeTitle");
  
    const successBox = document.getElementById("contentSuccess");
    const generalErr = document.getElementById("contentGeneralError");
  
    const { validators, attach, showError, clearError } = window.Validation;

    // Toggle episode fields visibility based on type
    function syncEpisodeVisibility() {
      if (!seriesEpisodeFields) return;
      const isSeries = String(typeEl.value) === 'Series';
      seriesEpisodeFields.classList.toggle('d-none', !isSeries);
    }
    typeEl.addEventListener('change', syncEpisodeVisibility);
    syncEpisodeVisibility();
  
    // 3. Attach Validation 
    attach(
      form,
      [
        { el: extIdEl, rules: [{ test: validators.minLength(1), message: "External ID is required." }] },
        { el: titleEl, rules: [{ test: validators.minLength(1), message: "Title is required." }] },
        { 
          el: yearEl, 
          rules: [
            { 
              test: (val) => /^\d{4}$/.test(val) && +val > 1880 && +val < 2100, 
              message: "Must be a valid 4-digit year." 
            }
          ] 
        },
        { el: genresEl, rules: [{ test: validators.minLength(1), message: "At least one genre is required." }] },
        { el: typeEl, rules: [{ test: (val) => val === "Movie" || val === "Series", message: "Please select a type." }] },
      ],
      async () => {
        // 4. On-Success (Submit Logic)
        [successBox, generalErr].forEach(b => { 
          if (!b) return; 
          b.classList.add("d-none"); 
          b.textContent = ""; 
        });
        const isSeries = String(typeEl.value) === 'Series';
        const seasonVal = Number(seasonNumEl?.value || 0);
        const episodeVal = Number(episodeNumEl?.value || 0);
        const hasEpisodeNumbers = Number.isFinite(seasonVal) && seasonVal > 0 && Number.isFinite(episodeVal) && episodeVal > 0;
        const hasEpisodeVideo = videoFileEl.files.length > 0;
        const shouldAddEpisode = isSeries && hasEpisodeNumbers && hasEpisodeVideo;

        const contentData = new FormData();
        contentData.append('extId', extIdEl.value.trim());
        contentData.append('title', titleEl.value.trim());
        contentData.append('year', yearEl.value.trim());
        contentData.append('genres', genresEl.value.trim()); 
        contentData.append('type', typeEl.value);

        if (imageFileEl.files.length > 0) {
          contentData.append('imageFile', imageFileEl.files[0]);
        }
        // Only attach videoFile for Movies on the content endpoint.
        if (!isSeries && videoFileEl.files.length > 0) {
          contentData.append('videoFile', videoFileEl.files[0]);
        }

        const prevBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Uploading... (This may take a moment)";

        try {
          const res = await fetch("/api/admin/content", {
            method: "POST",
            body: contentData, 
            credentials: 'include',
          });

          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            const msg = `[${res.status}] ${data?.error || "Unable to submit content."}`;
            generalErr.classList.remove("d-none");
            generalErr.textContent = msg;
            return;
          }

          // Success
          successBox.classList.remove("d-none");
          let actionText = (res.status === 201) ? "created" : "updated";
          let message = `Success! Content '${data.data.title}' was ${actionText}. Rating: ${data.data.rating || 'N/A'}`;

          // If Series and episode details provided, upload episode using the same video file
          if (shouldAddEpisode) {
            try {
              const epData = new FormData();
              epData.append('seriesExtId', extIdEl.value.trim());
              epData.append('season', String(seasonVal));
              epData.append('episode', String(episodeVal));
              epData.append('title', String(episodeTitleEl?.value || ''));
              epData.append('videoFile', videoFileEl.files[0]);

              const epRes = await fetch('/api/admin/episodes', { method: 'POST', body: epData, credentials: 'include' });
              const epJson = await epRes.json().catch(()=>({}));
              if (!epRes.ok) {
                throw new Error(epJson?.error || `Episode upload failed (HTTP ${epRes.status})`);
              }
              const s = epJson?.episode?.season ?? seasonVal;
              const e = epJson?.episode?.episode ?? episodeVal;
              message += ` Episode uploaded: S${s}E${e}.`;
            } catch (epErr) {
              generalErr.classList.remove("d-none");
              generalErr.textContent = String(epErr?.message || 'Episode upload failed');
            }
          }

          successBox.textContent = message;
          
          form.reset(); 
          
        } catch (e) {
          generalErr.classList.remove("d-none");
          generalErr.textContent = "Server unreachable or upload failed. Is the file too large?";
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = prevBtnText;
        }
      }
    );
  })();
