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
  
    const successBox = document.getElementById("contentSuccess");
    const generalErr = document.getElementById("contentGeneralError");
  
    const { validators, attach, showError, clearError } = window.Validation;
  
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
        const formData = new FormData();
        
        formData.append('extId', extIdEl.value.trim());
        formData.append('title', titleEl.value.trim());
        formData.append('year', yearEl.value.trim());
        formData.append('genres', genresEl.value.trim()); 
        formData.append('type', typeEl.value);

        if (imageFileEl.files.length > 0) {
          formData.append('imageFile', imageFileEl.files[0]);
        }
        if (videoFileEl.files.length > 0) {
          formData.append('videoFile', videoFileEl.files[0]);
        }

        const prevBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "Uploading... (This may take a moment)";

        try {
          const res = await fetch("/api/admin/content", {
            method: "POST",
            body: formData, 
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
          successBox.textContent = `Success! Content '${data.data.title}' was ${actionText}. Rating: ${data.data.rating || 'N/A'}`;
          
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