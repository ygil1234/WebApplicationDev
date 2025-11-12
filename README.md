# 🎬 Netflix Project Technical R&D Documentation

![Node.js](https://img.shields.io/badge/Node.js-16+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express.js-Backend-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-success?logo=mongodb)
![Bootstrap](https://img.shields.io/badge/Frontend-Bootstrap%205-orange)

---

## 1. Project Overview

This project is a **full-stack Netflix Clone** designed for R&D and educational purposes.  
It combines a **Node.js / Express / MongoDB backend** with a **vanilla JavaScript + HTML + Bootstrap** frontend.

### Tech Stack

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

### Backend (`server/`)

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
- `profileController.js`
- `userController.js`

#### Models (`server/models/`)
Define Mongoose schemas for:
- `User`
- `Profile`
- `Video`
- `Like`
- `WatchProgress`
- `Log`
- `Session`

#### Middleware (`server/middlewares/`)
- `auth.js` → Authentication / authorization checks  
- `upload.js` → Configures Multer for file uploads  
- `validation.js` → Server-side data validation

---
---

#### Key Client Scripts
- shared input validation  
- content browsing, search, likes  
- detail page, playback & progress tracking  
- admin dashboard for content CRUD  
- profile management, statistics (Chart.js)

---

## 3. API Reference

### Auth

| Method | Endpoint       | Description                |
| ------ | -------------- | -------------------------- |
| `POST` | `/signup`      | Create new user account    |
| `POST` | `/login`       | Login as regular user      |
| `POST` | `/admin-login` | Login as admin             |
| `POST` | `/logout`      | Logout and destroy session |

### Profiles *

| Method   | Endpoint        | Description            |
| -------- | --------------- | ---------------------- |
| `GET`    | `/profiles`     | Get all profiles       |
| `POST`   | `/profiles`     | Create profile (max 5) |
| `PUT`    | `/profiles/:id` | Update name/avatar     |
| `DELETE` | `/profiles/:id` | Delete profile         |
| `GET`    | `/progress`        | Fetch watch progress|
| `POST`   | `/progress`        | Update progress     |
| `DELETE` | `/progress`        | Reset progress      |

### Video / Content

| Method   | Endpoint           | Description                  |
| -------- | ------------------ | ---------------------------- |
| `GET`    | `/feed`            | Get feed content             |
| `GET`    | `/search`          | Search by title/genre        |
| `GET`    | `/content/:extId`  | Get single title details     |
| `GET`    | `/similar`         | Get similar content          |
| `GET`    | `/recommendations` | Personalized recommendations |
| `POST`   | `/likes/toggle`    | Like/unlike content          |
| `GET`  | `/stats/daily-views`      | Daily view statistics   |

### User & Stats

| Method | Endpoint                  | Description              |
| ------ | ------------------------- | ------------------------ |
| `GET`  | `/config`                 | Frontend config          |
| `GET`  | `/stats/daily-views`      | Daily view statistics    |
| `GET`  | `/stats/genre-popularity` | Genre popularity chart   |

### Admin *(Requires Admin Auth)*

| Method | Endpoint                    | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| `GET`  | `/admin/content`            | List all content                       |
| `GET`  | `/admin/content/:extId`     | Get full item details                  |
| `POST` | `/admin/episodes`           | Add or update series episode           |
| `POST` | `/admin/repair-media-paths` | Fix broken media paths                 |

---

## 4. Setup & Running

### Prerequisites

* Node.js 
* npm
* MongoDB 

### Configuration

Create a `.env` file in `server/`:

```bash
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/netflix_feed
SESSION_SECRET=a_very_strong_and_random_secret_key
SEED_CONTENT=1
ROW_SCROLL_STEP=how_many_cards_to_scroll
OMDB_API_KEY=your_omdb_key_here
NODE_ENV=development
ADMIN_USER=a_very_strong_and_random_user
ADMIN_PASSWORD=a_very_strong_and_random_password
```

### Execution
cd WebApplicationDev
npm i
node server/index.js

Access at: **[http://localhost:3000](http://localhost:3000)**
