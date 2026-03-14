const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  try {
    // Find user by identifier OR email
    const user = await User.findOne({ 
      $or: [{ identifier }, { email: identifier }] 
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.disabled) {
      return res.status(403).json({ success: false, message: 'Account disabled' });
    }

    // Generate token
    const payload = { user: { id: user.id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5d' });

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        identifier: user.identifier,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        badgeNumber: user.badgeNumber,
        department: user.department,
        lastLogin: user.lastLogin,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { identifier, email, password, firstName, lastName, badgeNumber, department } = req.body;
  
  try {
    // Check if user exists
    const exists = await User.findOne({ 
      $or: [{ identifier }, { email }] 
    });
    
    if (exists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    // Create user (role defaults to 'officer' via schema)
    const user = new User({
      identifier,
      email,
      password: hashed,
      firstName,
      lastName,
      // role: role || 'officer' ← Remove this line
      badgeNumber,
      department,
      // role will be set by schema default
    });
    
    await user.save();

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        identifier: user.identifier,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        badgeNumber: user.badgeNumber,
        department: user.department
      }
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
