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
      { el: userEl,  rules: [{ test: validators.minLength(3), message: "Username must be at least 3 characters." }] },
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
          generalErr.classList.remove("d-none");
          alert(`Error ${res.status}: ${data?.error || "Unknown error"}`);
          generalErr.textContent = data?.error || "Unable to create account.";
          return;
        }

        alert("User Created Successfully!");
        window.location.href = "login.html";
      } catch (_) {
        generalErr.classList.remove("d-none");
        generalErr.textContent = "Server Unreachable";
      }
    }
  );
})();
