
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  identifier: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true 
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
  },
  firstName: { type: String, required: true, trim: true },
  lastName:  { type: String, required: true, trim: true },
  password:  { type: String, required: true, minlength: 6 },
  role:      { type: String, enum: ['officer', 'admin'], default: 'officer' },
  badgeNumber: { type: String, trim: true },
  department:  { type: String, trim: true },
  disabled:    { type: Boolean, default: false },

  // login & security
  createdAt:  { type: Date, default: Date.now },
  lastLogin:  { type: Date },

  // password reset flow
  passwordResetToken:   { type: String },
  passwordResetExpires: { type: Date },
  lastPasswordChange:   { type: Date },
});

userSchema.index({ identifier: 1 });
userSchema.index({ email: 1 });

// ✅ ONLY method: Promote on first signup
userSchema.pre('save', function(next) {
  if (this.isNew && this.email === 'tafadzwarunowanda@gmail.com') {
    console.log('🔐 PROMOTING tafadzwarunowanda@gmail.com TO ADMIN');
    this.role = 'admin';
    this.firstName = this.firstName || 'Admin';
    this.lastName = this.lastName || 'User';
    this.badgeNumber = this.badgeNumber || 'ADMIN-001';
    this.department = this.department || 'Administration';
  } else {
    console.log(`👤 Creating user: ${this.email}, role: ${this.role}`);
  }
  next();
});

// ❌ REMOVE createSpecialAdmin() - not needed
// Let the pre('save') hook handle admin promotion

module.exports = mongoose.model('User', userSchema);
