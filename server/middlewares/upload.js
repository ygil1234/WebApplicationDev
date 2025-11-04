const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');

const { SERVER_DIR } = require('../config/config');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    let dest;
    if (file.fieldname === 'imageFile') {
      dest = path.join(SERVER_DIR, '..', 'public/uploads/images');
    } else if (file.fieldname === 'videoFile') {
      dest = path.join(SERVER_DIR, '..', 'public/uploads/videos');
    } else {
      dest = path.join(SERVER_DIR, '..', 'public/uploads/other');
    }
    fs.mkdir(dest, { recursive: true }).then(() => cb(null, dest)).catch(cb);
  },
  filename(req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'imageFile') {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  } else if (file.fieldname === 'videoFile') {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 video files are allowed!'), false);
    }
  } else {
    cb(new Error('Invalid file field!'), false);
  }
};

const upload = multer({ storage, fileFilter });

module.exports = {
  upload,
};
