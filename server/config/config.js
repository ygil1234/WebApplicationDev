const path = require('path');

const serverDir = path.resolve(__dirname, '..');
const projectRoot = path.resolve(serverDir, '..');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

const ROW_SCROLL_STEP_RAW = Number.parseInt(process.env.ROW_SCROLL_STEP ?? '5', 10);
const ROW_SCROLL_STEP = Number.isFinite(ROW_SCROLL_STEP_RAW) && ROW_SCROLL_STEP_RAW > 0
  ? ROW_SCROLL_STEP_RAW
  : 5;

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV,
  IS_PROD,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/netflix_feed',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev_secret_change_me',
  SEED_CONTENT: process.env.SEED_CONTENT === '1',
  ROW_SCROLL_STEP,
  OMDB_API_KEY: process.env.OMDB_API_KEY,
  ADMIN_USER: process.env.ADMIN_USER,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  CONTENT_JSON_CANDIDATES: [
    path.resolve(serverDir, 'content.json'),
    path.resolve(projectRoot, 'server/content.json'),
    path.resolve(projectRoot, 'content.json'),
  ],
  SERVER_DIR: serverDir,
  PROJECT_ROOT: projectRoot,
};
