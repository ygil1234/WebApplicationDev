const express = require('express');

const {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
} = require('../controllers/profileController');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

router.get('/profiles', requireAuth, listProfiles);
router.post('/profiles', requireAuth, createProfile);
router.put('/profiles/:id', requireAuth, updateProfile);
router.delete('/profiles/:id', requireAuth, deleteProfile);

module.exports = router;
