const { ADMIN_USER, ADMIN_PASSWORD } = require("../config/config");

const EMAIL_RX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function validEmail(value) {
  return EMAIL_RX.test(String(value || '').trim());
}

function validPassword(password, username = '') {
  if (String(username).toLowerCase() === ADMIN_USER && password === ADMIN_PASSWORD) return true;
  return typeof password === 'string' && password.trim().length >= 6;
}

function validUsername(name) {
  return /^[A-Za-z0-9_]{3,15}$/.test(String(name || '').trim());
}

module.exports = {
  validEmail,
  validPassword,
  validUsername,
};
