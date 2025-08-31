const mongoose = require('mongoose');

const testRecordSchema = new mongoose.Schema({
  officerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  idNumber: {
    type: String,
    required: true,
    trim: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: true
  },
  numberPlate: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  alcoholLevel: {
    type: Number,
    required: true,
    min: 0,
    max: 1.0
  },
  location: {
    type: String,
    required: true,
    trim: true
  },
  deviceSerial: {
    type: String,
    required: true,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },
  photoUrl: {
    type: String,
    trim: true
  },
  synced: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['normal', 'exceeded'],
    default: function() {
      return this.alcoholLevel > 0.08 ? 'exceeded' : 'normal';
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
testRecordSchema.index({ officerId: 1, createdAt: -1 });
testRecordSchema.index({ synced: 1, createdAt: 1 });

module.exports = mongoose.model('TestRecord', testRecordSchema);
