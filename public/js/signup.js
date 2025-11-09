// JS/signup.js

(function () {
  const activeUser = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser"); // Check both storage areas for an existing session.
  if (activeUser) { // If the visitor is already signed in, keep them off the signup view.
    const destination = activeUser.toLowerCase() === "admin" ? "admin.html" : "feed.html"; // Route admins differently from regular users.
    window.location.replace(destination); // Swap the current page so the browser history doesn't land back on signup.
    return; // Abort further initialization because the page is no longer relevant.
  }
  const form   = document.getElementById("signupForm");
  const emailEl = document.getElementById("email");
  const userEl  = document.getElementById("username");
  const passEl  = document.getElementById("password");

  const successBox = document.getElementById("signupSuccess");
  const generalErr = document.getElementById("signupGeneralError");

  const { validators, attach, showError, clearError } = window.Validation;

  attach(
    form,
    [
      { el: emailEl, rules: [{ test: validators.email, message: "Please enter a valid email." }] },
      { el: userEl,  rules: [{ test: validators.username, message: "Username must be 3–15 characters (letters, numbers, underscores)." }] },
      { 
        el: passEl,  
        rules: [
          { 
            test: validators.minLength(6),
            message: "Password must be at least 6 characters." 
          }
        ] 
      }
    ],
    async () => {
      [successBox, generalErr].forEach(b => { if (!b) return; b.classList.add("d-none"); b.textContent = ""; });

      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: 'include', 
          body: JSON.stringify({
            email: emailEl.value.trim(),
            username: userEl.value.trim(),
            password: passEl.value
          })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = `[${res.status}] ${data?.error || "Unable to create account."}`;

          if (/email/i.test(data?.error || "")) {
            showError(emailEl, msg);
          } else if (/username/i.test(data?.error || "")) {
            showError(userEl, msg);
          } else if (/password/i.test(data?.error || "")) {
            showError(passEl, msg);
          } else {
            generalErr.classList.remove("d-none");
            generalErr.textContent = msg;
          }
          return;
        }

        // Success
        successBox.classList.remove("d-none");
        successBox.textContent = "Account created! Redirecting…";
        window.location.href = "login.html";
      } catch (e) {
        generalErr.classList.remove("d-none");
        generalErr.textContent = "Server unreachable. Is the backend running?";
      }
    }
  );
})();