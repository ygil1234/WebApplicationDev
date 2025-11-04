const express = require('express');

const {
  getFeed,
  searchContent,
  toggleLike,
  getContentDetails,
  getSimilar,
  getProgress,
  setProgress,
  deleteProgress,
  getRecommendations,
} = require('../controllers/videoController');

const router = express.Router();

router.get('/feed', getFeed);
router.get('/search', searchContent);
router.post('/likes/toggle', toggleLike);
router.get('/content/:extId', getContentDetails);
router.get('/similar', getSimilar);
router.get('/progress', getProgress);
router.post('/progress', setProgress);
router.delete('/progress', deleteProgress);
router.get('/recommendations', getRecommendations);

module.exports = router;
