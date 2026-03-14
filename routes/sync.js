const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const TestRecord = require('../models/TestRecord');

// GET /api/sync/pending - Get unsynced records for current officer
router.get('/pending', protect, async (req, res) => {
  try {
    const records = await TestRecord.find({
      officerId: req.user._id,
      synced: false
    }).sort({ createdAt: 1 });

    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error('Failed to fetch pending records:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending records'
    });
  }
});

// POST /api/sync/sync - Upload offline records
router.post('/sync', protect, async (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Records array is required'
    });
  }

  try {
    const saved = [];
    const failed = [];

    for (const record of records) {
      try {
        const test = new TestRecord({
          ...record,
          officerId: req.user._id,
          synced: true
        });
        await test.save();
        saved.push(test);
      } catch (err) {
        console.error('Failed to sync record:', err);
        failed.push({
          idNumber: record.idNumber || 'unknown',
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      synced: saved.length,
      failed: failed.length,
      failedList: failed,
      message: `Sync complete: ${saved.length} records saved, ${failed.length} failed`
    });
  } catch (error) {
    console.error('Sync failed:', error);
    res.status(500).json({
      success: false,
      message: 'Sync failed due to server error'
    });
  }
});

// GET /api/sync/history - Get all synced records for officer
router.get('/history', protect, async (req, res) => {
  try {
    const records = await TestRecord.find({ 
      officerId: req.user._id,
      synced: true
    }).sort('-createdAt');

    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error('Failed to load history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load history'
    });
  }
});

module.exports = router;
