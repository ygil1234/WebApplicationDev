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
  return typeof name === "string" && name.trim().length >= 3;
}

app.post("/api/signup", (req, res) => {
  const { email, username, password } = req.body || {};

  if (!validEmail(email)) return res.status(400).json({ error: "Invalid email." });
  if (!username || String(username).trim().length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
  if (!validPassword(password)) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const users = readUsers();

  if (users.find((u) => String(u.email).toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "Email already registered." });
  }
  if (users.find((u) => String(u.username).toLowerCase() === String(username).toLowerCase())) {
    return res.status(409).json({ error: "Username already taken." });
  }

  const newUser = { email, username, password };
  users.push(newUser);
  writeUsers(users);

  res.status(201).json({ message: "User created.", user: { email, username } });
  console.log(`User ${newUser.username} created successfully`);
});

app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body || {};
  const id = (identifier || "").trim();

  const isEmail = validEmail(id);
  const isUser = validUsername(id);

  if (!id || (!isEmail && !isUser)) {
    return res.status(400).json({ error: "Enter a valid email or a username." });
  }
  if (!validPassword(password)) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const users = readUsers();
  const user = isEmail
    ? users.find((u) => String(u.email).toLowerCase() === id.toLowerCase() && String(u.password) === String(password))
    : users.find((u) => String(u.username).toLowerCase() === id.toLowerCase() && String(u.password) === String(password));

  if (!user) return res.status(401).json({ error: "Email/username or password doesn’t exist" });

  console.log(`User ${user.username} logged on successfully`);
  return res.status(200).json({ message: "Login successful.", user: { email: user.email, username: user.username } });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
