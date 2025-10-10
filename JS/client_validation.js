// JS/client_validation.js
(function () {
  // ---------- DOM helpers ----------
  function ensureErrorEl(input) {
    let error = input.nextElementSibling;
    if (!error || !error.classList.contains("login-error-message")) {
      error = document.createElement("div");
      error.classList.add("login-error-message");
      error.setAttribute("role", "alert");
      error.setAttribute("aria-live", "polite");
      input.parentNode.appendChild(error);
    }
    if (!error.id) {
      error.id = input.id ? `${input.id}__error` : `err_${Math.random().toString(36).slice(2)}`;
    }
    if (input.getAttribute("aria-describedby")) {
      const ids = new Set(input.getAttribute("aria-describedby").split(/\s+/).filter(Boolean));
      ids.add(error.id);
      input.setAttribute("aria-describedby", Array.from(ids).join(" "));
    } else {
      input.setAttribute("aria-describedby", error.id);
    }
    return error;
  }

  function showError(input, message) {
    const error = ensureErrorEl(input);
    error.textContent = message || "Invalid value.";
    error.classList.remove("d-none");
    input.classList.add("login-input-error");
    input.setAttribute("aria-invalid", "true");
  }

  function clearError(input) {
    const error = input.nextElementSibling;
    if (error && error.classList.contains("login-error-message")) {
      error.textContent = "";
      error.classList.add("d-none");
    }
    input.classList.remove("login-input-error");
    input.removeAttribute("aria-invalid");
  }

  // ---------- Validators ----------
  const validators = {
    email(value) {
      const v = String(value || "").trim();
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return emailRegex.test(v);
    },
    minLength(len) {
      return (value) => String(value || "").trim().length >= len;
    },
    username(value) {
      const v = String(value || "").trim();
      const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
      return usernameRegex.test(v);
    }
  };

  // ---------- Attach ----------
  /**
   * @param {HTMLFormElement} form
   * @param {Array<{el:HTMLElement, rules:Array<{test:Function|boolean, message:string}>}>} config
   * @param {Function} onSuccess  
   */
  function attach(form, config, onSuccess) {
    config.forEach(({ el, rules }) => {
      el.addEventListener("input", () => clearError(el));
      el.addEventListener("blur", () => {
        clearError(el);
        for (const r of rules) {
          const ok = typeof r.test === "function" ? r.test(el.value) : !!r.test;
          if (!ok) {
            showError(el, r.message);
            break;
          }
        }
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let valid = true;

      for (const { el, rules } of config) {
        clearError(el);
        for (const r of rules) {
          const ok = typeof r.test === "function" ? r.test(el.value) : !!r.test;
          if (!ok) {
            showError(el, r.message);
            valid = false;
            break;
          }
        }
      }
      if (!valid) return;
      const submitBtn = form.querySelector('button[type="submit"], button:not([type])');
      const prevText = submitBtn ? submitBtn.textContent : null;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-disabled", "true");
        submitBtn.textContent = "Processing…";
      }

      try {
        const maybePromise = typeof onSuccess === "function" ? onSuccess() : null;
        if (maybePromise && typeof maybePromise.then === "function") {
          await maybePromise;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-disabled");
          if (prevText != null) submitBtn.textContent = prevText;
        }
      }
    });
  }

  window.Validation = { showError, clearError, validators, attach };
})();
