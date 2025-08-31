// controllers/authController.js
const User = require('../models/User');
const { generateToken } = require('../utils/jwt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto'); // For generating reset tokens

// --- SIGNUP IMPLEMENTATION ---
/**
 * Signup user
 * 1. Validates required fields
 * 2. Checks if user already exists (by identifier or email)
 * 3. Hashes password
 * 4. Determines role (first user is admin)
 * 5. Creates new user
 * 6. Generates JWT token
 * 7. Responds with success, token, and user info
 */
const signup = async (req, res) => {
  try {
    const { identifier, email, firstName, lastName, password, badgeNumber } = req.body;

    // Basic validation
    if (!identifier || !password || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: 'Identifier, password, first name, and last name are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ identifier }, { email }] // Check by identifier or email
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this identifier or email already exists'
      });
    }

    // Hash password before saving
    const saltRounds = 10; // Adjust rounds as needed for security/performance
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Determine role (e.g., first user is admin, rest are officers)
    // This is a simple check, you might want a more robust admin assignment method
    const userCount = await User.countDocuments();
    const role = userCount === 0 ? 'admin' : 'officer';

    // Create new user
    const user = new User({
      identifier,
      email: email || undefined, // Allow email to be optional or undefined
      firstName,
      lastName,
      password: hashedPassword, // Store the hashed password
      badgeNumber: badgeNumber || undefined, // Allow badgeNumber to be optional
      role // Assign role
    });

    const savedUser = await user.save();

    // Generate JWT token for the new user
    const token = generateToken(savedUser._id);

    // Respond with success, token, and user info (excluding password)
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: savedUser._id,
        identifier: savedUser.identifier,
        email: savedUser.email,
        firstName: savedUser.firstName,
        lastName: savedUser.lastName,
        badgeNumber: savedUser.badgeNumber,
        role: savedUser.role,
        createdAt: savedUser.createdAt
        // Add other non-sensitive user fields if needed
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Signup failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// --- LOGIN IMPLEMENTATION ---
/**
 * Login user
 * 1. Validates identifier and password
 * 2. Finds user by identifier or email
 * 3. Compares password
 * 4. Updates last login timestamp
 * 5. Generates JWT token
 * 6. Responds with success, token, and user info
 */
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Identifier and password are required'
      });
    }

    // Find user by identifier (could be ID number, badge number, email, etc.)
    // We'll search by identifier or email
    const user = await User.findOne({
      $or: [{ identifier }, { email: identifier }] // Allow login with email as identifier
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login timestamp
    user.lastLogin = Date.now();
    await user.save();

    // Generate JWT token
    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        identifier: user.identifier,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        badgeNumber: user.badgeNumber,
        role: user.role,
        lastLogin: user.lastLogin
        // Add other non-sensitive user fields if needed
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// --- GET PROFILE IMPLEMENTATION ---
/**
 * Get user profile
 * 1. Uses protect middleware to ensure user is authenticated (req.user is populated)
 * 2. Finds user by ID (excluding password)
 * 3. Responds with user data
 */
const getProfile = async (req, res) => {
  try {
    // `req.user` is populated by the `protect` middleware
    const user = await User.findById(req.user.id).select('-password'); // Exclude password

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
       user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// --- FORGOT PASSWORD IMPLEMENTATION ---
/**
 * Forgot Password
 * 1. Finds user by email
 * 2. Generates reset token
 * 3. Hashes token and saves to DB with expiry
 * 4. Logs token to console (for now, later send email)
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // 1. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
        // For security, don't reveal if email exists
        console.log(`Forgot password requested for non-existent email: ${email}`);
        // Still send a success response to avoid enumeration
        return res.status(200).json({
            success: true,
            message: 'If your email is registered, you will receive a password reset link shortly.'
        });
    }

    // 2. Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // 3. Hash token and set expiry (e.g., 1 hour)
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetTokenExpiry = Date.now() + 60 * 60 * 1000; // 1 hour from now

    // 4. Save hashed token and expiry to user document
    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = resetTokenExpiry;
    await user.save({ validateBeforeSave: false }); // Skip validation to avoid issues with other fields

    // 5. Log the token (DO NOT DO THIS IN PRODUCTION!)
    // In production, you would send an email with a link like:
    // `https://your-frontend-domain.com/reset-password/${resetToken}`
    console.log(`*** PASSWORD RESET TOKEN FOR ${user.email}: ${resetToken} ***`);
    console.log(`(Hashed token in DB: ${hashedToken})`);
    console.log(`Expiry: ${new Date(resetTokenExpiry).toISOString()}`);

    res.status(200).json({
      success: true,
      message: 'If your email is registered, you will receive a password reset link shortly.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset request failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// --- RESET PASSWORD IMPLEMENTATION ---
/**
 * Reset Password
 * 1. Finds user by hashed token and checks expiry
 * 2. Validates new password
 * 3. Hashes new password and saves
 * 4. Clears reset token fields
 * 5. Logs user in (optional: generate new token)
 */
const resetPassword = async (req, res) => {
  try {
    const { token } = req.params; // Get token from URL params
    const { newPassword } = req.body; // Get new password from request body

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (newPassword.length < 8) {
         return res.status(400).json({
             success: false,
             message: 'Password must be at least 8 characters long.'
         });
     }

    // Basic password strength check (you can expand this)
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!strongPasswordRegex.test(newPassword)) {
        return res.status(400).json({
            success: false,
            message: 'Password must contain uppercase, lowercase, number, and special character.'
        });
    }

    // 1. Hash the token from the URL to compare with DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Find user with matching hashed token and not expired
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() } // Check if not expired
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token'
      });
    }

    // 3. Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // 4. Update user's password and clear reset token fields
    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    // Optional: Update last password change timestamp
    user.lastPasswordChange = Date.now();
    await user.save();

    // 5. (Optional) Log the user in automatically by generating a new token
    const newToken = generateToken(user._id);

    // 6. Send success response (optionally with new token)
    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
       newToken // Include new token if auto-login desired
      // user: { ... } // Optionally include user info
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// --- EXPORT ALL FUNCTIONS ---
module.exports = {
  signup,          // Existing function
  login,           // Existing function
  getProfile,      // Existing function
  forgotPassword,  // New function
  resetPassword    // New function
};
// --- END EXPORT ALL FUNCTIONS ---
