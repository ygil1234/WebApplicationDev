# 🎬 Netflix Clone — Technical R&D Documentation

![Node.js](https://img.shields.io/badge/Node.js-16+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express.js-Backend-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-success?logo=mongodb)
![Bootstrap](https://img.shields.io/badge/Frontend-Bootstrap%205-orange)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

---

## 📑 Table of Contents

1. [Project Overview](#1-project-overview)  
2. [System Architecture](#2-system-architecture)  
3. [Data Models](#3-data-models)  
4. [API Reference](#4-api-reference)  
5. [Setup & Running](#5-setup--running)  
6. [Admin Access](#6-admin-access)  
7. [Future Improvements](#7-future-improvements)  
8. [Author](#8-author)

---

## 1. Project Overview

This project is a **full-stack Netflix Clone** designed for R&D and educational purposes.  
It combines a **Node.js / Express / MongoDB backend** with a **vanilla JavaScript + HTML + Bootstrap** frontend.

### 🧰 Tech Stack

| Layer | Technology |
|-------|-------------|
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB (via Mongoose ODM) |
| **Authentication** | `express-session` + `connect-mongo` (persistent sessions) |
| **Password Hashing** | `bcryptjs` |
| **File Uploads** | `multer` (image/video uploads to `public/uploads`) |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, Bootstrap 5 |
| **Data Seeding** | `content.json` seeded on startup |
| **Communication** | RESTful API via `fetch()` |

---

## 2. System Architecture

### 🖥️ Backend (`server/`)

The backend is an **Express.js application** (`server/index.js`) responsible for:
- Business logic
- Data persistence
- Authentication
- API management

#### Configuration
- File: `server/config/config.js`
- Loaded via `dotenv`  
- Key environment variables:
  - `PORT`
  - `MONGODB_URI`
  - `SESSION_SECRET`
  - `OMDB_API_KEY`

#### Routing (`server/routes/`)

| File | Description |
|------|--------------|
| `authRoutes.js` | User/admin signup, login, logout |
| `profileRoutes.js` | CRUD operations for profiles |
| `videoRoutes.js` | Feed, search, likes, progress |
| `adminRoutes.js` | Secure content management |
| `userRoutes.js` | Statistics and health checks |

#### Controllers (`server/controllers/`)
Contain business logic for each route:
- `videoController.js`
- `adminController.js`
- `authController.js`

#### Models (`server/models/`)
Define Mongoose schemas for:
- `User`
- `Profile`
- `Video`
- `Like`
- `WatchProgress`
- `Log`

#### Middleware (`server/middlewares/`)
- `auth.js` → Authentication / authorization checks  
- `upload.js` → Configures Multer for file uploads  
- `validation.js` → Server-side data validation

---

### 🎨 Frontend (`views/` & `public/`)

The frontend is served as **static HTML pages** from `views/`, with interactivity handled via JS in `public/js/`.

| Directory | Purpose |
|------------|----------|
| `views/` | Page templates (`login.html`, `feed.html`, `admin.html`, etc.) |
| `public/js/` | Frontend logic scripts |

#### Key Client Scripts
- `client_validation.js` — shared input validation  
- `feed.js` — content browsing, search, likes  
- `title.js` — detail page, playback & progress tracking  
- `admin.js` — admin dashboard for content CRUD  
- `settings.js` — profile management, statistics (Chart.js)

---

## 3. Data Models (Mongoose Schemas)

Located in `server/models/`.

### 🧑 User
```js
{
  email: { type: String, unique: true },
  username: { type: String, unique: true },
  password: String // bcrypt-hashed
}
````

### 👤 Profile

```js
{
  userId: { type: ObjectId, ref: "User" },
  name: String,
  avatar: String
}
```

### 🎥 Video (Content)

```js
{
  extId: { type: String, unique: true },
  title: String,
  year: Number,
  genres: [String],
  likes: Number,
  type: String, // "Movie" or "Series"
  plot: String,
  videoPath: String,
  episodes: [
    {
      season: Number,
      episode: Number,
      title: String,
      videoPath: String
    }
  ]
}
```

### ❤️ Like

```js
{
  profileId: String,
  contentExtId: String
}
```

### ⏯️ WatchProgress

```js
{
  profileId: String,
  contentExtId: String,
  season: Number,
  episode: Number,
  positionSec: Number,
  durationSec: Number,
  completed: Boolean
}
```

### 🧾 Log

Used for internal app event tracking via `writeLog()`.

---

## 4. API Reference

> All API routes are prefixed with `/api`.

### 🔐 Auth

| Method | Endpoint       | Description                |
| ------ | -------------- | -------------------------- |
| `POST` | `/signup`      | Create new user account    |
| `POST` | `/login`       | Login as regular user      |
| `POST` | `/admin-login` | Login as admin             |
| `POST` | `/logout`      | Logout and destroy session |

### 👥 Profiles *(Requires Auth)*

| Method   | Endpoint        | Description            |
| -------- | --------------- | ---------------------- |
| `GET`    | `/profiles`     | Get all profiles       |
| `POST`   | `/profiles`     | Create profile (max 5) |
| `PUT`    | `/profiles/:id` | Update name/avatar     |
| `DELETE` | `/profiles/:id` | Delete profile         |

### 🎬 Video / Content

| Method   | Endpoint           | Description                  |
| -------- | ------------------ | ---------------------------- |
| `GET`    | `/feed`            | Get feed content             |
| `GET`    | `/search`          | Search by title/genre        |
| `GET`    | `/content/:extId`  | Get single title details     |
| `GET`    | `/similar`         | Get similar content          |
| `GET`    | `/recommendations` | Personalized recommendations |
| `POST`   | `/likes/toggle`    | Like/unlike content          |
| `GET`    | `/progress`        | Fetch watch progress         |
| `POST`   | `/progress`        | Update progress              |
| `DELETE` | `/progress`        | Reset progress               |

### 📊 User & Stats

| Method | Endpoint                  | Description              |
| ------ | ------------------------- | ------------------------ |
| `GET`  | `/health`                 | Server & DB health check |
| `GET`  | `/config`                 | Frontend config          |
| `GET`  | `/stats/daily-views`      | Daily view statistics    |
| `GET`  | `/stats/genre-popularity` | Genre popularity chart   |

### 🛠️ Admin *(Requires Admin Auth)*

| Method | Endpoint                    | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| `GET`  | `/admin/content`            | List all content                       |
| `GET`  | `/admin/content/:extId`     | Get full item details                  |
| `POST` | `/admin/content`            | Create/update content (upload support) |
| `POST` | `/admin/episodes`           | Add or update series episode           |
| `POST` | `/admin/repair-media-paths` | Fix broken media paths                 |

---

## 5. Setup & Running

### ⚙️ Prerequisites

* Node.js ≥ 16
* npm
* MongoDB (local or Atlas cloud)

### 🔧 Configuration

Create a `.env` file in `server/`:

```bash
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/netflix_feed
SESSION_SECRET=a_very_strong_and_random_secret_key
SEED_CONTENT=1
OMDB_API_KEY=your_omdb_key_here
NODE_ENV=development
```

### 📦 Installation

```bash
cd server
npm install
```

### 🚀 Run the Application

```bash
npm start
```

Access at: **[http://localhost:3000](http://localhost:3000)**

---

## 6. Admin Access (Default)

**URL:** [http://localhost:3000/login.html](http://localhost:3000/login.html)
**Username:** `admin`
**Password:** `admin`

> This login is handled by `authController.js → adminLogin()` and bypasses the standard `User` model.

---


### 📝 License

MIT License © 2025 Rotem Fisher
