const TestRecord = require('../models/TestRecord');

const syncOfflineRecords = async (req, res) => {
  try {
    const records = req.body.records;
    if (!Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Invalid data format. Expected array of records.' });
    }
    if (records.length === 0) {
      return res.status(200).json({ success: true, message: 'No records provided for sync.', synced: 0, errors: [] });
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

        if (!driverName || !driverId || alcoholConcentration === undefined) {
          errors.push({ recordId: record.id || 'unknown', error: 'Missing required fields: driverName, driverId, alcoholConcentration' });
          continue;
        }

        const level = parseFloat(alcoholConcentration);
        if (isNaN(level) || level < 0 || level > 1.0) {
          errors.push({ recordId: record.id || 'unknown', error: 'Invalid alcohol level' });
          continue;
        }

        const recordTimestamp = dateTime ? new Date(dateTime) : new Date();

        // No officerId check, just save
        const status = level > 0.08 ? 'exceeded' : 'normal';

        const newRecord = new TestRecord({
          officerId: '', // leave empty or use a default value
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
    // Return all unsynced records, ignoring officerId
    const records = await TestRecord.find({ synced: false }).sort({ timestamp: -1 });
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error('Get unsynced records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve unsynced records' });
  }
};

module.exports = { syncOfflineRecords, getUnsyncedRecords };

