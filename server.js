// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const USERS_FILE = path.join(__dirname, "users.json");

app.use(express.json());
app.use(express.static(__dirname));

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]", "utf-8");
}

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeUsers(arr) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

function validEmail(v) {
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(String(v || "").trim());
}

function validPassword(pw) {
  return typeof pw === "string" && pw.trim().length >= 6;
}

function validUsername(name) {
  const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
  return usernameRegex.test(String(name || "").trim());
}

/* ========== SIGNUP (distinct errors preserved) ========== */
app.post("/api/signup", (req, res) => {
  const email = String(req.body?.email || "").trim();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!validEmail(email)) return res.status(400).json({ error: "Invalid email." });
  if (!validUsername(username)) return res.status(400).json({ error: "Username must be 3-15 characters, letters/numbers/underscores only." });
  if (!validPassword(password)) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const users = readUsers();

  const emailTaken = users.some(u => String(u.email).toLowerCase() === email.toLowerCase());
  if (emailTaken) return res.status(409).json({ error: "Email already registered." });

  const usernameTaken = users.some(u => String(u.username).toLowerCase() === username.toLowerCase());
  if (usernameTaken) return res.status(409).json({ error: "Username already taken." });

  const newUser = { email, username, password };
  users.push(newUser);
  writeUsers(users);

  console.log(`User ${username} created successfully`);
  return res.status(201).json({ message: "User created.", user: { email, username } });
});

app.post("/api/login", (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");

  if (!validEmail(email)) return res.status(400).json({ error: "Invalid email." });
  if (!validPassword(password)) return res.status(400).json({ error: "Password must be at least 6 characters." });


  const users = readUsers();

  const user = users.find(u => String(u.email).toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Email not found." });

  if (String(user.password) !== password) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  console.log(`User ${user.username} logged on successfully`);
  return res.status(200).json({
    message: "Login successful.",
    user: { email: user.email, username: user.username }
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
