const mongoose = require('mongoose');

const watchProgressSchema = new mongoose.Schema(
  {
    profileId: { type: String, index: true, required: true },
    contentExtId: { type: String, index: true, required: true },
    season: { type: Number, default: null },
    episode: { type: Number, default: null },
    positionSec: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

watchProgressSchema.index(
  { profileId: 1, contentExtId: 1, season: 1, episode: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.WatchProgress || mongoose.model('WatchProgress', watchProgressSchema);
