// JS/login.js
(function () {
  const form = document.getElementById("signinForm");
  const emailInput = document.getElementById("emailPhone");
  const passwordInput = document.getElementById("password");
  const generalErr = document.getElementById("loginGeneralError");

  const { validators, attach } = window.Validation;

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
            test: validators.email,
            message: "Please enter a valid email address."
          }
        ]
      },
      {
        el: passwordInput,
        rules: [
          { test: validators.minLength(6), message: "Password must be at least 6 characters." }
        ]
      }
    ],
    async () => {
      clearGeneral();
      const payload = {
        email: emailInput.value.trim(),
        password: passwordInput.value.trim()
      };
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          showGeneral(data?.error || "Unable to sign in.");
          alert(`Error ${res.status}: ${data?.error || "Unknown error"}`);
          return;
        }

        localStorage.setItem("mail", payload.email);
        localStorage.setItem("password", payload.password);
        window.location.href = "profiles.html";
      } catch {
        showGeneral("Server Unreachable");
        alert("Network error");
      }
    }
  );
})();
