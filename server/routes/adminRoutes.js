const express = require('express');

const {
  createOrUpdateContent,
  upsertEpisode,
  repairMediaPaths,
} = require('../controllers/adminController');
const { requireAuth, requireAdmin } = require('../middlewares/auth');
const { upload } = require('../middlewares/upload');

const router = express.Router();

const contentUpload = upload.fields([
  { name: 'imageFile', maxCount: 1 },
  { name: 'videoFile', maxCount: 1 },
]);
const episodeUpload = upload.fields([{ name: 'videoFile', maxCount: 1 }]);

router.post('/admin/content', requireAuth, requireAdmin, contentUpload, createOrUpdateContent);
router.post('/admin/episodes', requireAuth, requireAdmin, episodeUpload, upsertEpisode);
router.post('/admin/repair-media-paths', requireAuth, requireAdmin, repairMediaPaths);

module.exports = router;
