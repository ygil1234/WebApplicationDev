const express = require('express');

const {
  appConfig,
  dailyViews,
  genrePopularity,
} = require('../controllers/userController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/config', appConfig);
router.get('/stats/daily-views', requireAuth, dailyViews);
router.get('/stats/genre-popularity', requireAuth, genrePopularity);

module.exports = router;
