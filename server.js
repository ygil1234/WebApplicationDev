// server.js
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const USERS_FILE = path.join(__dirname, "users.json");
const PROFILES_FILE = path.join(__dirname, "profiles.json");

app.use(express.json());
app.use(express.static(__dirname));

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, "[]", "utf-8");
}

if (!fs.existsSync(PROFILES_FILE)) {
  fs.writeFileSync(PROFILES_FILE, "[]", "utf-8");
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

function readProfiles() {
  try {
    const raw = fs.readFileSync(PROFILES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeProfiles(arr) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(arr, null, 2), "utf-8");
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

/* ========== SIGNUP ========== */
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

/* ========== LOGIN ========== */
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

  console.log(`User ${user.username} logged in successfully`);
  return res.status(200).json({
    message: "Login successful.",
    user: { 
      email: user.email, 
      username: user.username 
    }
  });
});

/* ========== PROFILES ========== */

// GET /api/profiles
app.get("/api/profiles", (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  try {
    const allProfiles = readProfiles();
    const userProfiles = allProfiles.filter(p => p.userId === userId);
    
    console.log(`Retrieved ${userProfiles.length} profiles for user: ${userId}`);
    return res.status(200).json(userProfiles);
  } catch (error) {
    console.error("Error reading profiles:", error);
    return res.status(500).json({ error: "Failed to load profiles." });
  }
});

// POST /api/profiles
app.post("/api/profiles", (req, res) => {
  const { userId, name, avatar } = req.body;

  if (!userId || !name || !avatar) {
    return res.status(400).json({ error: "User ID, name, and avatar are required." });
  }

  if (typeof name !== "string" || name.trim().length < 2) {
    return res.status(400).json({ error: "Profile name must be at least 2 characters." });
  }

  if (name.trim().length > 20) {
    return res.status(400).json({ error: "Profile name must be at most 20 characters." });
  }

  try {
    const allProfiles = readProfiles();
    const userProfiles = allProfiles.filter(p => p.userId === userId);

    if (userProfiles.length >= 5) {
      return res.status(400).json({ error: "Maximum of 5 profiles per user." });
    }

    const nameExists = userProfiles.some(
      p => p.name.toLowerCase() === name.trim().toLowerCase()
    );
    
    if (nameExists) {
      return res.status(409).json({ error: "Profile name already exists." });
    }

    const maxId = allProfiles.length > 0 
      ? Math.max(...allProfiles.map(p => p.id || 0))
      : 0;
    
    const newProfile = {
      id: maxId + 1,
      userId: userId,
      name: name.trim(),
      avatar: avatar,
      createdAt: new Date().toISOString(),
      likedContent: []
    };

    allProfiles.push(newProfile);
    writeProfiles(allProfiles);

    console.log(`Profile "${newProfile.name}" created for user: ${userId}`);
    return res.status(201).json({ 
      message: "Profile created successfully.", 
      profile: newProfile 
    });
  } catch (error) {
    console.error("Error creating profile:", error);
    return res.status(500).json({ error: "Failed to create profile." });
  }
});


// ========== CONTENT CATALOG ==========
app.get("/api/content", (req, res) => {
  try {
    const file = path.join(__dirname, "content.json");
    if (!fs.existsSync(file)) {
      return res.status(200).json([]);
    }
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);

    let out = [];
    if (Array.isArray(data)) out = data;
    else if (Array.isArray(data?.items)) out = data.items;
    else if (Array.isArray(data?.catalog)) out = data.catalog;
    else if (Array.isArray(data?.data)) out = data.data;
    else if (data && typeof data === "object") {
      const vals = Object.values(data).filter(Array.isArray).flat();
      if (Array.isArray(vals)) out = vals;
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error("Failed to load content.json:", err);
    return res.status(500).json({ error: "Failed to load content." });
  }
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});