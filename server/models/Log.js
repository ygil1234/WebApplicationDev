const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    event: { type: String, required: true },
    userId: { type: String, default: null },
    profileId: { type: String, default: null },
    details: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Log || mongoose.model('Log', logSchema);
