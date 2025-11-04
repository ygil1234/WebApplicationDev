const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

async function connectDatabase(uri) {
  try {
    await mongoose.connect(uri);
    console.log('[mongo] connected');
  } catch (err) {
    console.error('[mongo] connection error:', err.message);
  }
}

module.exports = {
  connectDatabase,
};
