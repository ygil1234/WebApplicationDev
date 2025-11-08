// JS/login.js
(function () {
  const activeUser = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser"); // Look for an existing user marker in either storage bucket.
  if (activeUser) { // If a session already exists, keep the visitor away from the login form.
    const destination = activeUser.toLowerCase() === "admin" ? "admin.html" : "feed.html"; // Admins head to their dashboard; everyone else hits the feed.
    window.location.replace(destination); // Replace history with the target page so back button won't re-open login.
    return; // Stop wiring the login form since we're leaving the page.
  }
  const form = document.getElementById("signinForm");
  const emailInput = document.getElementById("emailPhone");
  const passwordInput = document.getElementById("password");
  const generalErr = document.getElementById("loginGeneralError");

  const { validators, attach, showError, clearError } = window.Validation;

  function showGeneral(message) {
    if (!generalErr) return;
    generalErr.classList.remove("d-none");
    generalErr.textContent = message;
  }

  function clearGeneral() {
    if (!generalErr) return;
    generalErr.classList.add("d-none");
    generalErr.textContent = "";
  }

  attach(
    form,
    [
      {
        el: emailInput,
        rules: [
          {
            test: (value) => {
              if (value.trim().toLowerCase() === "admin") return true; 
              return validators.email(value); 
            },
            message: "Please enter a valid email address or 'admin'."
          }
        ]
      },
      {
        el: passwordInput,
        rules: [
          { 
            test: (passValue) => {
              const emailVal = emailInput.value.trim().toLowerCase();
              if (emailVal === 'admin') {
                return passValue.length > 0; 
              }
              return validators.minLength(6)(passValue); 
            }, 
            message: "Password is required." 
          }
        ]
      }
    ],
    async () => {
      clearGeneral();

      const emailVal = emailInput.value.trim().toLowerCase();
      const passVal = passwordInput.value.trim();

      if (emailVal === "admin") {
        try {
          const res = await fetch("/api/admin-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include', 
            body: JSON.stringify({ email: emailVal, password: passVal })
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showError(passwordInput, data?.error || "Incorrect admin credentials.");
            return;
          }

          const data = await res.json();
          localStorage.setItem("loggedInUser", "admin");
          localStorage.setItem("loggedInUserEmail", "admin");
          window.location.href = "admin.html"; 
          return;
        } catch {
          showGeneral("Server Unreachable");
          return;
        }
      }

      const payload = {
        email: emailVal,
        password: passVal
      };

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = `[${res.status}] ${data?.error || "Unable to sign in."}`;

          if (res.status === 400 && /email/i.test(data?.error || "")) {
            showError(emailInput, msg);
          } else if (res.status === 401 && /email/i.test(data?.error || "")) {
            showError(emailInput, msg);
          } else if (res.status === 401 && /password/i.test(data?.error || "")) {
            showError(passwordInput, msg);
          } else {
            showGeneral(msg);
          }
          return;
        }
        const data = await res.json();
        localStorage.setItem("loggedInUser", data.user.username);
        localStorage.setItem("loggedInUserEmail", data.user.email);

        if (data.user.username.toLowerCase() === 'admin') {
            window.location.href = "admin.html";
        } else {
            window.location.href = "profiles.html";
        }
      } catch {
        showGeneral("Server Unreachable");
      }
    }
  );
})();
