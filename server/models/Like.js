const mongoose = require('mongoose');

const likeSchema = new mongoose.Schema(
  {
    profileId: { type: String, index: true },
    contentExtId: { type: String, index: true },
  },
  { timestamps: true }
);

likeSchema.index({ profileId: 1, contentExtId: 1 }, { unique: true });

module.exports = mongoose.models.Like || mongoose.model('Like', likeSchema);
