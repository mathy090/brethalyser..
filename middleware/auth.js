const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // we expect payload like { user: { id: '...' } }
    const userId = decoded?.user?.id || decoded?.userId || decoded?.id;
    if (!userId) throw new Error('Invalid token payload');

    const user = await User.findById(userId).select('-password');
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
    if (user.disabled) {
      return res.status(403).json({ success: false, message: 'Account disabled' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
  }
};

const admin = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Admin access required' });
};

module.exports = { protect, admin };
