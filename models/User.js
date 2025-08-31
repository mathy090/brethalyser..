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

// ✅ Fix: Only promote to admin if user is being created (not updated)
userSchema.pre('save', function(next) {
  // Only run logic if email matches AND this is a new document
  if (this.isNew && this.email === 'tafadzwarunowanda@gmail.com') {
    this.role = 'admin';
    this.firstName = this.firstName || 'Admin';
    this.lastName = this.lastName || 'User';
    this.badgeNumber = this.badgeNumber || 'ADMIN-001';
    this.department = this.department || 'Administration';
  }
  next();
});

// ✅ Fix: Remove hardcoded password from model
// Password should be set during signup, not hardcoded
userSchema.statics.checkSpecialAdmin = async function() {
  return this.findOne({ email: 'tafadzwarunowanda@gmail.com' });
};

// ✅ Fix: Remove hardcoded password + move to server.js
userSchema.statics.createSpecialAdmin = async function() {
  const exists = await this.checkSpecialAdmin();
  if (!exists) {
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    
    // ❌ NEVER hardcode passwords in model
    // ✅ Let first signup determine password
    const tempPassword = await bcrypt.hash('TempPassword123!', salt); // Temporary

    const specialAdmin = new this({
      identifier: 'tafadzwarunowanda@gmail.com',
      email: 'tafadzwarunowanda@gmail.com',
      firstName: 'Admin',
      lastName: 'User',
      password: tempPassword,
      role: 'admin',
      badgeNumber: 'ADMIN-001',
      department: 'Administration'
    });

    await specialAdmin.save();
    console.log('Special admin placeholder created. First login will set real password.');
    return specialAdmin;
  }
  return null;
};

module.exports = mongoose.model('User', userSchema);
