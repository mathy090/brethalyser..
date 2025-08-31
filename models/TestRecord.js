const mongoose = require('mongoose');

const testRecordSchema = new mongoose.Schema({
  // person tested
  idNumber:   { type: String, required: true, trim: true, minlength: 3, maxlength: 20 },
  gender:     { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
  identifier: { type: String, required: true, trim: true }, // e.g., driver unique identifier

  // officer & device
  officerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deviceSerial: { type: String, required: true, trim: true, maxlength: 50 },

  // test details
  numberPlate:  { type: String, required: true, trim: true, maxlength: 15 },
  alcoholLevel: { type: Number, required: true, min: 0, max: 1.0 },
  fineAmount:   { type: Number, default: 0, min: 0 },
  location:     { type: String, required: true, trim: true, maxlength: 100 },
  status:       { type: String, enum: ['normal', 'exceeded', 'invalid'], default: 'normal' },
  notes:        { type: String, trim: true, maxlength: 500 },
  synced:       { type: Boolean, default: false },

  // media
  photo: { type: String }, // base64 string OR URL (frontend decides; we store the value)

  // bookkeeping
  timestamp: { type: Date, default: Date.now },
  source:    { type: String, default: 'mobile_app' },
}, {
  timestamps: true
});

// derive fields
testRecordSchema.pre('save', function(next) {
  if (this.alcoholLevel > 0.05) this.status = 'exceeded';
  else                           this.status = 'normal';

  if (this.status === 'exceeded') {
    this.fineAmount = Math.max(100, Math.floor((this.alcoholLevel - 0.05) * 10000));
  } else {
    this.fineAmount = 0;
  }
  next();
});

// indexes
testRecordSchema.index({ officerId: 1, timestamp: -1 });
testRecordSchema.index({ identifier: 1, timestamp: -1 });
testRecordSchema.index({ synced: 1 });
testRecordSchema.index({ timestamp: -1 });

module.exports = mongoose.model('TestRecord', testRecordSchema);

