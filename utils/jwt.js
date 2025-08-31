const jwt = require('jsonwebtoken');
require('dotenv').config();

const generateToken = (userId) => {
  return jwt.sign(
    { user: { id: userId } }, // <-- matches middleware/auth.js
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '5d' }
  );
};

module.exports = { generateToken };
