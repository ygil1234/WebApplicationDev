const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema(
  {
    season: { type: Number, required: true },
    episode: { type: Number, required: true },
    title: { type: String, default: '' },
    videoPath: { type: String, required: true },
    durationSec: { type: Number, default: 0 },
  },
  { _id: false }
);

const contentSchema = new mongoose.Schema(
  {
    extId: { type: String, unique: true, index: true },
    title: { type: String, required: true },
    year: Number,
    genres: { type: [String], default: [] },
    likes: { type: Number, default: 0 },
    cover: String,
    type: String,
    plot: { type: String },
    director: { type: String },
    actors: { type: [String], default: [] },
    rating: { type: String },
    ratingValue: { type: Number, default: null },
    imagePath: { type: String },
    videoPath: { type: String },
    episodes: { type: [episodeSchema], default: [] },
  },
  { timestamps: true }
);

contentSchema.index({ title: 'text' });
contentSchema.index({ genres: 1 });
contentSchema.index({ likes: -1, title: 1 });
contentSchema.index({ ratingValue: -1, likes: -1 });

module.exports = mongoose.models.Content || mongoose.model('Content', contentSchema);
