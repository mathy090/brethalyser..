const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const User = require('../models/User');
const TestRecord = require('../models/TestRecord');

// GET /api/admin/users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ role: -1, createdAt: 1 });
    res.json({ success: true, users });
  } catch (err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/admin/tests
router.get('/tests', protect, admin, async (req, res) => {
  try {
    const records = await TestRecord.find()
      .populate('officerId', 'firstName lastName email badgeNumber role')
      .sort({ createdAt: -1 });
    res.json({ success: true, records });
  } catch (err) {
    console.error('Error fetching records:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/admin/sync-count
router.get('/sync-count', protect, admin, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await TestRecord.countDocuments({ createdAt: { $gte: cutoff } });
    res.json({ success: true, count });
  } catch (err) {
    console.error('Error fetching sync count:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/ban (consistent naming)
router.patch('/users/:id/ban', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.disabled = true;
    await user.save();
    
    res.json({ 
      success: true, 
      message: `User ${user.email} has been banned`,
      user: {
        id: user._id,
        email: user.email,
        disabled: user.disabled
      }
    });
  } catch (err) {
    console.error('Error banning user:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PATCH /api/admin/users/:id/promote
router.patch('/users/:id/promote', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.role = 'admin';
    await user.save();
    
    res.json({ 
      success: true, 
      message: `User ${user.email} promoted to admin`,
      user: {
        id: user._id,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error promoting user:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;




