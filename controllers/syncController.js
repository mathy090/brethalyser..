const TestRecord = require('../models/TestRecord');
const path = require('path');
const fs = require('fs');

// syncOfflineRecords handles multipart/form-data: photo + records array
const syncOfflineRecords = async (req, res) => {
  try {
    // Parse records from req.body (stringified JSON from FormData)
    let records;
    try {
      records = JSON.parse(req.body.records);
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Invalid records format' });
    }

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'No records to sync' });
    }

    // Attach uploaded photo to the first record (assuming one photo per record)
    if (req.file) {
      const photoUrl = `/uploads/${req.file.filename}`;
      records[0].driverLicensePhoto = photoUrl;
    }

    let syncedCount = 0;
    const errors = [];

    for (const record of records) {
      try {
        const {
          driverName,
          driverId,
          alcoholConcentration,
          fineAmount,
          dateTime,
          driverLicensePhoto,
          notes,
          gender,
        } = record;

        // Validate required fields
        if (!driverName || !driverId || alcoholConcentration === undefined) {
          errors.push({
            recordId: record.id || 'unknown',
            error: 'Missing required fields: driverName, driverId, alcoholConcentration'
          });
          continue;
        }

        const level = parseFloat(alcoholConcentration);
        if (isNaN(level) || level < 0 || level > 1.0) {
          errors.push({ recordId: record.id || 'unknown', error: 'Invalid alcohol level' });
          continue;
        }

        // Deduplicate by timestamp + officer
        const recordTimestamp = dateTime ? new Date(dateTime) : new Date();
        const existing = await TestRecord.findOne({ timestamp: recordTimestamp, officerId: req.user.id });
        if (existing) {
          syncedCount++;
          continue;
        }

        const status = level > 0.08 ? 'exceeded' : 'normal';

        const newRecord = new TestRecord({
          officerId: req.user.id,
          idNumber: driverId,
          gender: gender || 'Other',
          identifier: driverId,
          numberPlate: '',
          alcoholLevel: level,
          fineAmount: fineAmount || 0,
          location: '',
          deviceSerial: '',
          notes: notes || '',
          photoUrl: driverLicensePhoto || null,
          status,
          timestamp: recordTimestamp,
          source: 'mobile_app_offline_sync',
          synced: true,
        });

        await newRecord.save();
        syncedCount++;
      } catch (err) {
        errors.push({ recordId: record.id || 'unknown', error: err.message || 'Unknown error' });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Sync completed',
      synced: syncedCount,
      totalProcessed: records.length,
      errors,
    });

  } catch (error) {
    console.error('Sync records error:', error);
    res.status(500).json({ success: false, message: 'Failed to sync records' });
  }
};

const getUnsyncedRecords = async (req, res) => {
  try {
    const records = await TestRecord.find({ officerId: req.user.id, synced: false }).sort({ timestamp: -1 });
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error('Get unsynced records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve unsynced records' });
  }
};

module.exports = { syncOfflineRecords, getUnsyncedRecords };

