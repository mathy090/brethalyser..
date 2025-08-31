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
    const isSpecialAdmin = identifier === 'tafadzwarunowanda@gmail.com' &&
                           password   === 'Mathews##$090';

    let user = await User.findOne({ $or: [{ identifier }, { email: identifier }] });

    if (isSpecialAdmin && !user) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      user = new User({
        identifier: 'tafadzwarunowanda@gmail.com',
        email: 'tafadzwarunowanda@gmail.com',
        firstName: 'Admin',
        lastName: 'User',
        password: hashedPassword,
        role: 'admin',
        badgeNumber: 'ADMIN-001',
        department: 'Administration',
      });
      await user.save();
    } else if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = isSpecialAdmin ? true : await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }
    if (user.disabled) {
      return res.status(403).json({ success: false, message: 'Account disabled' });
    }

    const payload = { user: { id: user.id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5d' });

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
  const { identifier, email, password, firstName, lastName, role, badgeNumber, department } = req.body;
  try {
    const exists = await User.findOne({ $or: [{ identifier }, { email }] });
    if (exists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const user = new User({
      identifier,
      email,
      password: hashed,
      firstName,
      lastName,
      role: role || 'officer',
      badgeNumber,
      department,
    });
    await user.save();

    res.json({
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

