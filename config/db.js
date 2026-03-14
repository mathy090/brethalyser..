// config/db.js
const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    // Use the MongoDB URI from environment variables
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    // In production, you might want to exit the process
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

module.exports = connectDB;