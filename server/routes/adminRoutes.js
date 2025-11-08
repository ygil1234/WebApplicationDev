const express = require('express');

const {
  listContentSummaries,
  getContentByExtId,
  createOrUpdateContent,
  deleteContent,
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

router.get('/admin/content', requireAuth, requireAdmin, listContentSummaries);
router.get('/admin/content/:extId', requireAuth, requireAdmin, getContentByExtId);
router.post('/admin/content', requireAuth, requireAdmin, contentUpload, createOrUpdateContent);
router.delete('/admin/content', requireAuth, requireAdmin, deleteContent);
router.post('/admin/episodes', requireAuth, requireAdmin, episodeUpload, upsertEpisode);
router.post('/admin/repair-media-paths', requireAuth, requireAdmin, repairMediaPaths);

module.exports = router;
