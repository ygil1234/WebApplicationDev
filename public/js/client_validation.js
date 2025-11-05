// JS/client_validation.js
(function () {
  // ---------- DOM helpers ----------
  function locateExistingErrorEl(input) {
    if (input.__validationErrorEl && document.body.contains(input.__validationErrorEl)) {
      return input.__validationErrorEl;
    }
    let candidate = input.nextElementSibling;
    while (candidate && !(candidate.classList && candidate.classList.contains("login-error-message"))) {
      candidate = candidate.nextElementSibling;
    }
    if (!candidate && input.id) {
      const byId = document.getElementById(`${input.id}Error`) || document.getElementById(`${input.id}__error`);
      if (byId && byId.classList.contains("login-error-message")) {
        candidate = byId;
      }
    }
    if (!candidate && input.parentNode) {
      candidate = Array.from(input.parentNode.children).find((el) => {
        if (!el.classList || !el.classList.contains("login-error-message")) return false;
        if (!el.dataset.linkedInput) return true;
        return el.dataset.linkedInput === input.id;
      }) || null;
    }
    return candidate || null;
  }

  function ensureErrorEl(input) {
    let error = locateExistingErrorEl(input);
    if (!error) {
      error = document.createElement("div");
      error.classList.add("login-error-message");
      error.setAttribute("role", "alert");
      error.setAttribute("aria-live", "polite");
      const parent = input.parentNode || input.closest(".form-group") || input.parentElement;
      if (parent) {
        parent.insertBefore(error, input.nextSibling);
      } else {
        input.insertAdjacentElement("afterend", error);
      }
    }

    if (!error.id) {
      error.id = input.id ? `${input.id}__error` : `err_${Math.random().toString(36).slice(2)}`;
    }
    if (!error.dataset.linkedInput && input.id) {
      error.dataset.linkedInput = input.id;
    }

    if (input.getAttribute("aria-describedby")) {
      const ids = new Set(input.getAttribute("aria-describedby").split(/\s+/).filter(Boolean));
      ids.add(error.id);
      input.setAttribute("aria-describedby", Array.from(ids).join(" "));
    } else {
      input.setAttribute("aria-describedby", error.id);
    }

    input.__validationErrorEl = error;
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
    const error = locateExistingErrorEl(input);
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
