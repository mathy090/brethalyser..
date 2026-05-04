// src/helpers/validation.ts

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Zimbabwe National ID Validator ───────────────────────────────────────
// Formats: 
//   Spaced: 63-123456 A 12
//   Compact: 63-123456A12
//   Legacy: 01/232006083Z04

export function validateZimbabweanID(raw: string): ValidationResult {
  const n = raw.trim().toUpperCase();
  
  // Format 1: 63-123456 A 12 (with spaces)
  const spaced = /^\d{2}-\d{6}\s[A-Z]\s\d{2}$/;
  // Format 2: 63-123456A12 (compact)
  const compact = /^\d{2}-\d{6}[A-Z]\d{2}$/;
  // Format 3: 01/232006083Z04 (legacy OCR format)
  const legacy = /^\d{2}\/\d{6,9}[A-Z]\d{2}$/;
  
  if (spaced.test(n) || compact.test(n) || legacy.test(n)) {
    return { valid: true };
  }
  
  return { 
    valid: false, 
    error: "Invalid ID — expected: 63-123456 A 12, 63-123456A12, or 01/232006083Z04" 
  };
}

// ─── Licence Code Validator (SADC + Legacy) ───────────────────────────────
export function validateLicenceCode(raw: string): ValidationResult {
  const n = raw.trim().toUpperCase();
  
  // New SADC codes: A, A1, B, B1, BE, C, C1, CE, D, D1, DE
  const sadcPattern = /^(A1?|B1?E?|C1?E?|D1?E?|BE|CE|DE)$/;
  // Legacy numeric classes: 1-9
  const legacyPattern = /^[1-9]$/;
  
  if (sadcPattern.test(n) || legacyPattern.test(n)) {
    return { valid: true };
  }
  
  return { 
    valid: false, 
    error: "Invalid code — e.g. B, C, CE or old class 4" 
  };
}

// ─── Date Validator (DD/MM/YYYY) ──────────────────────────────────────────
export function isValidDate(d: string): boolean {
  const trimmed = d.trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return false;
  
  const [day, month, year] = trimmed.split("/").map(Number);
  const date = new Date(year, month - 1, day);
  
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    year >= 1900 && year <= 2100
  );
}

// ─── Licence Number Validator (AA00625325 format) ─────────────────────────
export function isValidLicenceNumber(n: string): boolean {
  const trimmed = n.trim().toUpperCase();
  // 1-3 letters followed by 5-10 digits
  return /^[A-Z]{1,3}\d{5,10}$/.test(trimmed);
}

// ─── Driver Form Validator ────────────────────────────────────────────────
export function validateDriverForm(
  fields: Partial<import("./constants").DriverData>
): Record<string, string> {
  const errors: Record<string, string> = {};
  
  if (!fields.surname?.trim()) {
    errors.surname = "Surname is required";
  } else if (fields.surname.trim().length < 2) {
    errors.surname = "Surname too short";
  }
  
  if (!fields.firstName?.trim()) {
    errors.firstName = "First name is required";
  } else if (fields.firstName.trim().length < 2) {
    errors.firstName = "First name too short";
  }
  
  const idResult = validateZimbabweanID(fields.idNumber || "");
  if (!fields.idNumber?.trim()) {
    errors.idNumber = "ID number is required";
  } else if (!idResult.valid) {
    errors.idNumber = idResult.error;
  }
  
  if (!fields.licenceNumber?.trim()) {
    errors.licenceNumber = "Licence number is required";
  } else if (!isValidLicenceNumber(fields.licenceNumber)) {
    errors.licenceNumber = "Invalid format — e.g. AA00625325";
  }
  
  if (!fields.licenceCode?.trim()) {
    errors.licenceCode = "Licence code is required";
  } else {
    const codeResult = validateLicenceCode(fields.licenceCode);
    if (!codeResult.valid) {
      errors.licenceCode = codeResult.error;
    }
  }
  
  if (fields.dateOfBirth && !isValidDate(fields.dateOfBirth)) {
    errors.dateOfBirth = "Invalid date — use DD/MM/YYYY";
  }
  
  if (fields.issueDate && !isValidDate(fields.issueDate)) {
    errors.issueDate = "Invalid date — use DD/MM/YYYY";
  }
  
  if (fields.expiryDate && !isValidDate(fields.expiryDate)) {
    errors.expiryDate = "Invalid date — use DD/MM/YYYY";
  }
  
  // Check expiry is after issue
  if (fields.issueDate && fields.expiryDate && isValidDate(fields.issueDate) && isValidDate(fields.expiryDate)) {
    const issue = new Date(fields.issueDate.split("/").reverse().join("-"));
    const expiry = new Date(fields.expiryDate.split("/").reverse().join("-"));
    if (expiry <= issue) {
      errors.expiryDate = "Expiry must be after issue date";
    }
  }
  
  return errors;
}