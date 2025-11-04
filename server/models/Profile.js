const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    name: { type: String, required: true },
    avatar: { type: String, required: true },
    likedContent: { type: [String], default: [] },
  },
  { timestamps: true }
);

profileSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.Profile || mongoose.model('Profile', profileSchema);
