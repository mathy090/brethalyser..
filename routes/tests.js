// routes/tests.js
const express = require('express');
const router = express.Router();
const upload = require('../utils/uploader');
const { protect } = require('../middleware/auth');
const TestRecord = require('../models/TestRecord');

// POST /api/tests - Create new test record with photo
router.post(
  '/',
  protect,
  upload.single('photo'),
  async (req, res) => {
    try {
      const {
        idNumber,
        gender,
        numberPlate,
        alcoholLevel,
        location,
        deviceSerial,
        notes
      } = req.body;

      // Create new test record
      const testRecord = new TestRecord({
        officerId: req.user.id,
        idNumber,
        gender,
        numberPlate,
        alcoholLevel,
        location,
        deviceSerial,
        notes,
        photoUrl: req.file ? `/uploads/${req.file.filename}` : null
      });

      await testRecord.save();

      res.status(201).json({
        success: true,
        data: testRecord
      });
    } catch (error) {
      console.error('Test record error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
);

// GET /api/tests/my - Get logged-in user's records
router.get('/my', protect, async (req, res) => {
  try {
    const records = await TestRecord.find({ officerId: req.user.id })
      .sort('-createdAt');
    
    res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;