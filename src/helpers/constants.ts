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
  surname:       40,
  firstName:     50,
  dateOfBirth:   10,
  gender:         1,
  idNumber:      20,
  licenceNumber: 12,
  licenceCode:    4,
  issueDate:     10,
  expiryDate:    10,
};

// SADC licence codes (new + legacy)
export const VALID_LICENCE_CODES = [
  "A", "A1", "B", "B1", "BE", "C", "C1", "CE", "D", "D1", "DE",
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