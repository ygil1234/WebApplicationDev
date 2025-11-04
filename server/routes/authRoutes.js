const express = require('express');

const {
  signup,
  adminLogin,
  login,
  logout,
} = require('../controllers/authController');

const router = express.Router();

router.post('/signup', signup);
router.post('/admin-login', adminLogin);
router.post('/login', login);
router.post('/logout', logout);

module.exports = router;
