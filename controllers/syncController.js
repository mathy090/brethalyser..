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
        const required = ['idNumber','gender','identifier','numberPlate','alcoholLevel','location','deviceSerial'];
        const missing = required.filter(k => record[k] === undefined || record[k] === null || record[k] === '');
        if (missing.length) {
          errors.push({ recordId: record.id || record.timestamp || 'unknown', error: `Missing fields: ${missing.join(', ')}` });
          continue;
        }

        const level = parseFloat(record.alcoholLevel);
        if (isNaN(level) || level < 0 || level > 1.0) {
          errors.push({ recordId: record.id || record.timestamp || 'unknown', error: 'Invalid alcohol level' });
          continue;
        }

        // dedupe by timestamp+officer
        let existing = null;
        if (record.timestamp) {
          existing = await TestRecord.findOne({ timestamp: new Date(record.timestamp), officerId: req.user.id });
        }

        if (existing) {
          syncedCount++;
          continue;
        }

        const status = level > 0.08 ? 'exceeded' : 'normal';
        const newRecord = new TestRecord({
          idNumber: record.idNumber,
          gender: record.gender,
          identifier: record.identifier,
          numberPlate: record.numberPlate,
          alcoholLevel: level,
          location: record.location,
          deviceSerial: record.deviceSerial,
          notes: record.notes,
          photo: record.photo,
          status,
          officerId: req.user.id,
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
          source: record.source || 'mobile_app_offline_sync',
          synced: true,
        });

        await newRecord.save();
        syncedCount++;
      } catch (e) {
        errors.push({ recordId: record.id || record.timestamp || 'unknown', error: e.message || 'Unknown error' });
      }
    }

    res.status(200).json({
      success: true,
      message: `Sync completed`,
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
    const records = await TestRecord.find({ officerId: req.user.id, synced: false })
      .sort({ timestamp: -1 });
    res.status(200).json({ success: true, count: records.length, data: records });
  } catch (error) {
    console.error('Get unsynced records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve unsynced records' });
  }
};

module.exports = { syncOfflineRecords, getUnsyncedRecords };
