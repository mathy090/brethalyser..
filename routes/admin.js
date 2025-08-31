const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const User = require('../models/User');
const TestRecord = require('../models/TestRecord');

// GET /api/admin/users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json({ success: true, users });
  } catch (err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/admin/records
router.get('/records', protect, admin, async (req, res) => {
  try {
    const records = await TestRecord.find().sort({ timestamp: -1 });
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
    const count = await TestRecord.countDocuments({ timestamp: { $gte: cutoff } });
    res.json({ success: true, count });
  } catch (err) {
    console.error('Error fetching sync count:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PATCH /api/admin/user/:id/disable (toggle)
router.patch('/user/:id/disable', protect, admin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.disabled = !user.disabled;
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    console.error('Error toggling user status:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;




