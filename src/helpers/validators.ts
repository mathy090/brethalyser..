export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ZW National ID: 63-123456 A 12 or compact 63-123456A12
export function validateZimbabweanID(raw: string): ValidationResult {
  const n = raw.trim().toUpperCase();
  if (/^\d{2}-\d{6}\s[A-Z]\s\d{2}$/.test(n) || /^\d{2}-\d{6}[A-Z]\d{2}$/.test(n)) {
    return { valid: true };
  }
  return { valid: false, error: "Invalid ID — expected: 63-123456 A 12" };
}

// SADC new codes: A A1 B B1 BE C C1 CE D D1 DE + old class 2 4 etc
export function validateLicenceCode(raw: string): ValidationResult {
  const n = raw.trim().toUpperCase();
  const SADC = /^(A1?|B1?E?|C1?E?|D1?E?|BE|CE|DE)$/;
  const OLD  = /^[1-9]$/;
  if (SADC.test(n) || OLD.test(n)) return { valid: true };
  return { valid: false, error: "Invalid code — e.g. B, C, CE or old class 4" };
}

export function validateDriverForm(fields: Partial<import("./constants").DriverData>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!fields.surname?.trim())      errors.surname       = "Surname required";
  if (!fields.firstName?.trim())    errors.firstName     = "First name required";
  if (!fields.idNumber?.trim())     errors.idNumber      = "ID number required";
  if (!fields.licenceNumber?.trim()) errors.licenceNumber = "Licence number required";
  if (!fields.licenceCode?.trim())  errors.licenceCode   = "Licence code required";
  return errors;
}