const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const testRoutes = require('./routes/tests');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');

const app = express();

// Connect to database
connectDB();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded photos
app.use('/uploads', express.static('uploads'));

// Rate limiting
const windowMin = parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10);
const maxReq = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
app.use(rateLimit({
  windowMs: windowMin * 60 * 1000,
  max: maxReq,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' }
}));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sync', syncRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Breathalyzer backend is running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  if (req.path.startsWith('/uploads/')) {
    return res.status(404).json({
      success: false,
      message: 'Photo not found'
    });
  }
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🚨 Server error:', err.message);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'File too large. Maximum size is 10MB.'
    });
  }

  if (err.message === 'Only images (jpeg, jpg, png) are allowed') {
    return res.status(400).json({
      success: false,
      message: 'Only images (jpeg, jpg, png) are allowed'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server after DB connection
const startServer = async () => {
  try {
    // Wait for DB connection
    await new Promise((resolve, reject) => {
      if (mongoose.connection.readyState === 1) return resolve();
      mongoose.connection.once('open', resolve);
      mongoose.connection.once('error', reject);
    });

    console.log('✅ DB connected successfully');

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`\n🔥 Breathalyzer backend running on port ${PORT} in ${process.env.NODE_ENV} mode`);
      console.log('💡 Special admin: tafadzwarunowanda@gmail.com');
      console.log('🔐 First signup with this email becomes admin (set your own password)');
      console.log('📸 Photo uploads: /uploads/');
      console.log('🛡️  Security: Helmet + Rate Limiting + CORS');
      console.log('🔄 Use /api/auth/signup to create the admin account\n');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('.SIGTERM signal received: closing HTTP server');
      server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
          console.log('MongoDB connection closed');
          process.exit(0);
        });
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// Start everything
startServer();
