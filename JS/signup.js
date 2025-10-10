// JS/signup.js
(function () {
  const form = document.getElementById("signupForm");
  const emailEl = document.getElementById("email");
  const userEl  = document.getElementById("username");
  const passEl  = document.getElementById("password");

  const successBox = document.getElementById("signupSuccess");
  const generalErr = document.getElementById("signupGeneralError");

  const { validators, attach, showError, clearError } = window.Validation;

  attach(

    // Client-side validation
    form,
    [
      { el: emailEl, rules: [{ test: validators.email, message: "Please enter a valid email." }] },
      { el: userEl, rules: [{ test: validators.username, message: "Username must be 3-20 characters, letters/numbers/underscores only." }] },
      { el: passEl,  rules: [{ test: validators.minLength(6), message: "Password must be at least 6 characters." }] }
    ],
    async () => {
      [successBox, generalErr].forEach(b => { b?.classList.add("d-none"); if (b) b.textContent = ""; });
      
      // Send request to the server
      try {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: emailEl.value.trim(),
            username: userEl.value.trim(),
            password: passEl.value
          })
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
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

        successBox.classList.remove("d-none");
        successBox.textContent = "Account created! Redirecting…";
        setTimeout(() => { window.location.href = "login.html"; }, 2000);
        window.location.href = "login.html";
      } catch (_) {
        generalErr.classList.remove("d-none");
        generalErr.textContent = "Server Unreachable";
      }
    }
  );
})();
