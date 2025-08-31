const TestRecord = require('../models/TestRecord');
const User = require('../models/User');

const calculateFine = (alcoholLevel) => {
  const level = parseFloat(alcoholLevel);
  if (level <= 0.08) return 0;
  if (level <= 0.15) return 500;
  if (level <= 0.30) return 1000;
  return 2000;
};

const createTestRecord = async (req, res) => {
  try {
    const { idNumber, gender, identifier, numberPlate, alcoholLevel, location, deviceSerial, notes, photo } = req.body;

    if (!idNumber || !gender || !identifier || !numberPlate || alcoholLevel === undefined || !location || !deviceSerial) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const level = parseFloat(alcoholLevel);
    if (isNaN(level) || level < 0 || level > 1.0) {
      return res.status(400).json({ success: false, message: 'Invalid alcohol level. Must be between 0 and 1.0 mg/L' });
    }

    const status = level > 0.08 ? 'exceeded' : 'normal';
    const fineAmount = calculateFine(level);

    const record = new TestRecord({
      idNumber,
      gender,
      identifier,
      numberPlate,
      alcoholLevel: level,
      fineAmount,
      location,
      deviceSerial,
      status,
      notes,
      photo,
      officerId: req.user.id,
      source: 'mobile_app',
      synced: true,
    });

    const saved = await record.save();
    res.status(201).json({ success: true, record: saved });
  } catch (error) {
    console.error('Create test record error:', error);
    res.status(500).json({ success: false, message: 'Failed to create test record' });
  }
};

const getTestRecords = async (req, res) => {
  try {
    const { page = 1, limit = 20, synced } = req.query;
    const query = { officerId: req.user.id };
    if (synced !== undefined) query.synced = synced === 'true';

    const records = await TestRecord.find(query)
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .exec();

    const count = await TestRecord.countDocuments(query);

    res.status(200).json({
      success: true,
      count: records.length,
      totalPages: Math.ceil(count / Number(limit)),
      currentPage: Number(page),
      records,
    });
  } catch (error) {
    console.error('Get test records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve test records' });
  }
};

const getAllTestRecords = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user.role !== 'admin') return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });

    const { page = 1, limit = 20, synced } = req.query;
    const query = {};
    if (synced !== undefined) query.synced = synced === 'true';

    const records = await TestRecord.find(query)
      .populate('officerId', 'identifier firstName lastName badgeNumber')
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .exec();

    const count = await TestRecord.countDocuments(query);

    res.status(200).json({
      success: true,
      count: records.length,
      totalPages: Math.ceil(count / Number(limit)),
      currentPage: Number(page),
      records,
    });
  } catch (error) {
    console.error('Get all test records error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve all test records' });
  }
};

const getTestRecordById = async (req, res) => {
  try {
    const { id } = req.params;
    const me = await User.findById(req.user.id);
    const query = { _id: id, ...(me.role !== 'admin' ? { officerId: req.user.id } : {}) };
    const record = await TestRecord.findOne(query).populate('officerId', 'identifier firstName lastName badgeNumber');
    if (!record) return res.status(404).json({ success: false, message: 'Test record not found or access denied' });
    res.status(200).json({ success: true, record });
  } catch (error) {
    console.error('Get test record error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve test record' });
  }
};

module.exports = {
  createTestRecord,
  getTestRecords,
  getAllTestRecords,
  getTestRecordById,
};
