// src/helpers/ocrParser.ts
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { type DriverData, FIELD_LIMITS } from "./constants";

// ─────────────────────────────────────────────
// CLEANING (OCR NOISE FIX)
// ─────────────────────────────────────────────
function cleanText(raw: string): string {
  return raw
    .replace(/[|\\]/g, "/")
    .replace(/O(?=\d)/g, "0")
    .replace(/I(?=\d)/g, "1")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\/:-]/g, "")
    .trim();
}

// ─────────────────────────────────────────────
// FUZZY LABEL MATCHING
// ─────────────────────────────────────────────
function matches(line: string, keys: string[]) {
  const l = line.toLowerCase();
  return keys.some(k => l.includes(k));
}

// ─────────────────────────────────────────────
// SIMPLE SCORE SYSTEM
// ─────────────────────────────────────────────
function score(text: string) {
  let s = 0;
  if (text.length > 3) s++;
  if (/[A-Z]/i.test(text)) s++;
  if (/\d/.test(text)) s++;
  return s;
}

// ─────────────────────────────────────────────
// VALUE EXTRACTION
// ─────────────────────────────────────────────
function getValue(lines: string[], keys: string[]) {
  for (let i = 0; i < lines.length; i++) {
    if (matches(lines[i]!, keys)) {
      const colon = lines[i]!.split(":")[1];
      if (colon?.trim()) return colon.trim();

      if (lines[i + 1]?.trim()) return lines[i + 1]!.trim();
      if (lines[i + 2]?.trim()) return lines[i + 2]!.trim();
    }
  }
  return "";
}

// ─────────────────────────────────────────────
// ID CLEANER
// ─────────────────────────────────────────────
function cleanId(v: string) {
  return v
    .replace(/[|\\]/g, "/")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/\s+/g, "")
    .toUpperCase();
}

// ─────────────────────────────────────────────
// DATE EXTRACTION (SIMPLIFIED + STABLE)
// ─────────────────────────────────────────────
function extractDates(text: string) {
  const d = [...text.matchAll(/\d{2}\/\d{2}\/\d{4}/g)].map(m => m[0]);

  return {
    dob: d[0],
    issue: d[1],
    expiry: d[2],
  };
}

// ─────────────────────────────────────────────
// TITLE CASE
// ─────────────────────────────────────────────
function title(str: string) {
  return str.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────
// RESULT TYPE
// ─────────────────────────────────────────────
export interface OCRResult {
  data: Partial<DriverData>;
  confident: boolean;
  extracted: string[];
  missingFields: string[];
}

// ─────────────────────────────────────────────
// MAIN PARSER
// ─────────────────────────────────────────────
export function parseOCRText(raw: string): OCRResult {
  const cleaned = cleanText(raw);
  const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
  const full = lines.join(" ");

  const data: Partial<DriverData> = {};
  const extracted: string[] = [];

  // ── Surname ──
  const surname = getValue(lines, ["surname", "1 surname"]);
  if (surname && score(surname) >= 2) {
    data.surname = title(surname.split(" ")[0]).slice(0, FIELD_LIMITS.surname);
    extracted.push("surname");
  }

  // ── First Name ──
  const name = getValue(lines, ["name", "first name", "2 name"]);
  if (name && score(name) >= 2) {
    data.firstName = title(name).slice(0, FIELD_LIMITS.firstName);
    extracted.push("firstName");
  }

  // ── DOB + Gender ──
  const dob = getValue(lines, ["birth", "dob", "date of birth"]);
  const dm = dob.match(/\d{2}\/\d{2}\/\d{4}/);
  if (dm) {
    data.dateOfBirth = dm[0];
    extracted.push("dateOfBirth");
  }

  const gm = dob.match(/\b(M|F)\b/i);
  if (gm) {
    data.gender = gm[1].toUpperCase() as "M" | "F";
    extracted.push("gender");
  }

  // ── ID Number ──
  const id = cleanId(getValue(lines, ["id", "id number", "4d"]));
  const idm = id.match(/\d{2}\/\d{6,9}[A-Z]\d{2}/);
  if (idm) {
    data.idNumber = idm[0].slice(0, FIELD_LIMITS.idNumber);
    extracted.push("idNumber");
  }

  // ── Licence Number ──
  const lic = getValue(lines, ["licence", "license", "5"]);
  const lm = lic.match(/[A-Z]{1,3}\d{5,10}/i);
  if (lm) {
    data.licenceNumber = lm[0].toUpperCase().slice(0, FIELD_LIMITS.licenceNumber);
    extracted.push("licenceNumber");
  }

  // ── Code ──
  const code = getValue(lines, ["code", "class", "9"]);
  const cm =
    code.match(/(A1?|B1?E?|BE|C1?E?|CE|D1?E?|DE)/i) ||
    code.match(/([A-D]\d?E?)/i);

  if (cm?.[1]) {
    data.licenceCode = cm[1].toUpperCase().slice(0, FIELD_LIMITS.licenceCode);
    extracted.push("licenceCode");
  }

  // ── Dates fallback ──
  const { dob: d1, issue, expiry } = extractDates(full);

  if (!data.dateOfBirth && d1) {
    data.dateOfBirth = d1;
    extracted.push("dateOfBirth");
  }

  if (issue) {
    data.issueDate = issue;
    extracted.push("issueDate");
  }

  if (expiry) {
    data.expiryDate = expiry;
    extracted.push("expiryDate");
  }

  // ── Missing fields ──
  const required = [
    "surname",
    "firstName",
    "dateOfBirth",
    "idNumber",
    "licenceNumber",
    "licenceCode",
  ];

  const missingFields = required.filter(k => !data[k as keyof DriverData]);

  // ── Confidence ──
  const confident =
    extracted.length >= 4 &&
    !!data.idNumber &&
    !!data.surname &&
    !!data.licenceNumber;

  return {
    data,
    confident,
    extracted,
    missingFields,
  };
}

// ─────────────────────────────────────────────
// ML KIT BRIDGE
// ─────────────────────────────────────────────
export async function parseDriverLicence(photoUri: string): Promise<OCRResult> {
  const result = await TextRecognition.recognize(photoUri);
  return parseOCRText(result.text);
}