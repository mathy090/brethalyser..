// config/email.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const host = process.env.EMAIL_HOST || 'smtp.example.com';
const port = parseInt(process.env.EMAIL_PORT || '587', 10);
const secure = (process.env.EMAIL_SECURE || 'false') === 'true';
const user = process.env.EMAIL_USER || '';
const pass = process.env.EMAIL_PASS || '';

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: user && pass ? { user, pass } : undefined,
});

transporter.verify((error) => {
  if (error) {
    console.error('Email configuration error:', error.message);
  } else {
    console.log('Email server is ready to send messages');
  }
});

module.exports = transporter;
