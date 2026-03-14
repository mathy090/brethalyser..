// utils/helpers.js

// Format phone number
const formatPhoneNumber = (phoneNumber) => {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Check if it's a valid phone number
  if (cleaned.length < 10 || cleaned.length > 15) {
    return phoneNumber; // Return as is if invalid
  }
  
  // Format based on length
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (cleaned.length === 11 && cleaned[0] === '1') {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  } else {
    return `+${cleaned}`;
  }
};

// Generate unique ID
const generateUniqueId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Validate alcohol level
const validateAlcoholLevel = (level) => {
  return level >= 0 && level <= 1.0;
};

// Format timestamp
const formatTimestamp = (timestamp) => {
  return new Date(timestamp).toISOString();
};

module.exports = {
  formatPhoneNumber,
  generateUniqueId,
  validateAlcoholLevel,
  formatTimestamp
};