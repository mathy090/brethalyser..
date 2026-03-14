const Joi = require('joi');

const loginSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().min(6).required()
});

const testRecordSchema = Joi.object({
  idNumber: Joi.string().min(3).max(20).required(),
  gender: Joi.string().valid('Male', 'Female', 'Other').required(),
  identifier: Joi.string().required(),
  numberPlate: Joi.string().max(15).required(),
  alcoholLevel: Joi.number().min(0).max(1.0).required(),
  location: Joi.string().max(100).required(),
  deviceSerial: Joi.string().max(50).required(),
  notes: Joi.string().allow('').max(500),
  photo: Joi.string().allow('') // base64 or URL
});

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: true });
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }
  next();
};

module.exports = {
  validateLogin: validate(loginSchema),
  validateTestRecord: validate(testRecordSchema),
};
