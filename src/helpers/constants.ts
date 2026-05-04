// src/helpers/constants.ts

export interface DriverData {
  surname: string;
  firstName: string;
  dateOfBirth: string;      // DD/MM/YYYY
  gender: "M" | "F" | "";
  idNumber: string;         // ZW format: 63-123456A12 or 01/232006083Z04
  licenceNumber: string;    // Format: AA00625325
  licenceCode: string;      // SADC: A, B1, CE, etc. or old: 1-9
  issueDate: string;        // DD/MM/YYYY
  expiryDate: string;       // DD/MM/YYYY
}

// Field limits matching Zimbabwe licence + OCR tolerance buffer
export const FIELD_LIMITS: Record<keyof DriverData, number> = {
  surname:       40,  // ↑ from 20 for OCR noise + hyphenated names
  firstName:     50,  // ↑ from 30 for middle names + OCR artifacts
  dateOfBirth:   10,  // DD/MM/YYYY fixed
  gender:         1,   // M or F
  idNumber:      20,  // ↑ buffer for OCR misreads (slashes, O/0, I/1)
  licenceNumber: 12,  // ↑ from 10 for safety margin
  licenceCode:    4,   // SADC codes max length
  issueDate:     10,
  expiryDate:    10,
};

// SADC licence codes (new + legacy)
export const VALID_LICENCE_CODES = [
  // New SADC
  "A", "A1", "B", "B1", "BE", "C", "C1", "CE", "D", "D1", "DE",
  // Legacy Zimbabwe classes
  "1", "2", "3", "4", "5", "6", "7", "8", "9",
];

// Required fields for confidence scoring
export const REQUIRED_FIELDS: (keyof DriverData)[] = [
  "surname",
  "firstName", 
  "dateOfBirth",
  "idNumber",
  "licenceNumber",
  "licenceCode",
];