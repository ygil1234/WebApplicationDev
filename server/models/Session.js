const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String },
    session: { type: Object },
    expires: { type: Date },
  },
  {
    collection: 'sessions',
    strict: false,
  }
);

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
