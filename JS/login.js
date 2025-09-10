const form = document.getElementById("signinForm");
const emailInput = document.getElementById("emailPhone");
const passwordInput = document.getElementById("password");

// Show error
function showError(input, message) {
  let error = input.nextElementSibling;
  if (!error || !error.classList.contains("login-error-message")) {
    error = document.createElement("div");
    error.classList.add("login-error-message");
    input.parentNode.appendChild(error);
  }
  error.textContent = message;

  // CSS input error
  input.classList.add("login-input-error");
}

// Clear error
function clearError(input) {
  let error = input.nextElementSibling;
  if (error && error.classList.contains("login-error-message")) {
    error.textContent = "";
  }

  // CSS input error
  input.classList.remove("login-input-error");
}

// Validation
form.addEventListener("submit", function (event) {
  event.preventDefault();

  let valid = true;

  // Email check
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(emailInput.value.trim())) {
    showError(emailInput, "Please enter a valid email address.");
    valid = false;
  } else {
    clearError(emailInput);
  }

  // Password check
  if (passwordInput.value.trim().length < 6) {
    showError(passwordInput, "Password must be at least 6 characters.");
    valid = false;
  } else {
    clearError(passwordInput);
  }

  if (valid) {
    // Save inputs to the localStorage
    localStorage.setItem("mail", emailInput.value.trim());
    localStorage.setItem("password", passwordInput.value.trim());

    // Redirect to the next page
    window.location.href = "profiles.html";
  }
});
