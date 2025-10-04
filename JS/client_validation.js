(function () {
  function showError(input, message) {
    let error = input.nextElementSibling;
    if (!error || !error.classList.contains("login-error-message")) {
      error = document.createElement("div");
      error.classList.add("login-error-message");
      input.parentNode.appendChild(error);
    }
    error.textContent = message;
    error.classList.remove("d-none");
    input.classList.add("login-input-error");
  }

  function clearError(input) {
    const error = input.nextElementSibling;
    if (error && error.classList.contains("login-error-message")) {
      error.textContent = "";
      error.classList.add("d-none");
    }
    input.classList.remove("login-input-error");
  }

  const validators = {
    email(value) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      return emailRegex.test(String(value).trim());
    },
    minLength(len) {
      return (value) => String(value || "").trim().length >= len;
    },
    username(value) {
      const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
      return usernameRegex.test(String(value).trim());
    }
  };

  function attach(form, config, onSuccess) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let valid = true;

      for (const field of config) {
        const { el, rules } = field;
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

      if (valid && typeof onSuccess === "function") onSuccess();
    });
  }

  window.Validation = { showError, clearError, validators, attach };
})();
