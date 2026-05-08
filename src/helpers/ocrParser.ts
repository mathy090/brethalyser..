// src/helpers/ocrParser.ts
// Never rejects. Always extracts what it can. Empty string for anything not found.

import { type DriverData } from "./constants";

export interface ParseResult {
  data: Partial<DriverData>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clean(text: string): string {
  return text
    .replace(/[|}{[\]]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/0(?=[a-zA-Z])|(?<=[a-zA-Z])0/g, "O") // fix 0→O next to letters
    .replace(/l(?=\d)|(?<=\d)l/g, "1")              // fix l→1 next to digits
    .trim();
}

function extractDate(text: string): string {
  // matches DD/MM/YYYY or DD-MM-YYYY or DDMMYYYY
  const slash = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if (slash) return `${slash[1]}/${slash[2]}/${slash[3]}`;

  const compact = text.match(/\b(\d{2})(\d{2})(\d{4})\b/);
  if (compact) return `${compact[1]}/${compact[2]}/${compact[3]}`;

  return "";
}

function findValueAfterLabel(
  lines: string[],
  index: number,
  label: RegExp
): string {
  const line = lines[index];
  // value on same line after colon
  const colon = line.match(/:(.+)$/);
  if (colon) {
    const val = clean(colon[1]);
    if (val.length > 0) return val;
  }
  // value on next line
  if (index + 1 < lines.length) {
    const next = clean(lines[index + 1]);
    if (next.length > 0 && !label.test(next)) return next;
  }
  return "";
}

function extractGender(text: string): string {
  const m = text.match(/\b(M|F|MALE|FEMALE)\b/i);
  if (!m) return "";
  const raw = m[1].toUpperCase();
  if (raw === "MALE" || raw === "M") return "M";
  if (raw === "FEMALE" || raw === "F") return "F";
  return "";
}

function extractLicenceCode(lines: string[]): string {
  for (const line of lines) {
    // licence codes are short: B, BE, C, CE, C1, EB, 4, etc.
    const m = line.match(/\bcode[:\s]+([A-Z0-9]{1,4})\b/i);
    if (m) return m[1].toUpperCase();
  }
  return "";
}

function extractIDNumber(lines: string[]): string {
  for (const line of lines) {
    // SA ID: 13 digits
    const m = line.match(/\b(\d{13})\b/);
    if (m) return m[1];
    // labelled
    const labelled = line.match(/id\s*(?:number|no)?[:\s]+([A-Z0-9]{6,15})/i);
    if (labelled) return clean(labelled[1]);
  }
  return "";
}

function extractLicenceNumber(lines: string[]): string {
  for (const line of lines) {
    const m = line.match(/licence\s*(?:number|no)?[:\s]+([A-Z0-9]{6,15})/i);
    if (m) return clean(m[1]);
  }
  return "";
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export function parseOCRText(rawText: string): ParseResult {
  // Nothing to parse — return empty partial, let UI prefill blanks
  if (!rawText || rawText.trim().length === 0) {
    return { data: {} };
  }

  const lines = rawText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const SURNAME_RE   = /surname|last\s*name|van\s*der/i;
  const FIRSTNAME_RE = /first\s*name|name[s]?|forename|initials/i;
  const DOB_RE       = /birth|dob|geboort/i;
  const GENDER_RE    = /gender|sex|geslag/i;
  const ID_RE        = /id\s*(number|no)?|identity/i;
  const LICENCE_RE   = /licen[sc]e?\s*(number|no)?|rij|permit/i;
  const CODE_RE      = /code|voertuig/i;
  const ISSUE_RE     = /issue|valid\s*from|vanaf|uitreiking/i;
  const EXPIRY_RE    = /expir|valid\s*to|verval|geldig/i;

  const data: Partial<DriverData> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!data.surname && SURNAME_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, SURNAME_RE);
      if (val) data.surname = val;
    }

    if (!data.firstName && FIRSTNAME_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, FIRSTNAME_RE);
      if (val) data.firstName = val;
    }

    if (!data.dateOfBirth && DOB_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, DOB_RE);
      data.dateOfBirth = extractDate(val || line);
    }

    if (!data.gender && GENDER_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, GENDER_RE);
      data.gender = extractGender(val || line);
    }

    if (!data.idNumber && ID_RE.test(line)) {
      data.idNumber = extractIDNumber(lines.slice(i, i + 2));
    }

    if (!data.licenceNumber && LICENCE_RE.test(line)) {
      data.licenceNumber = extractLicenceNumber(lines.slice(i, i + 2));
    }

    if (!data.licenceCode && CODE_RE.test(line)) {
      data.licenceCode = extractLicenceCode(lines.slice(i, i + 2));
    }

    if (!data.issueDate && ISSUE_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, ISSUE_RE);
      data.issueDate = extractDate(val || line);
    }

    if (!data.expiryDate && EXPIRY_RE.test(line)) {
      const val = findValueAfterLabel(lines, i, EXPIRY_RE);
      data.expiryDate = extractDate(val || line);
    }
  }

  // Fallback: if no ID found yet, scan all lines for a 13-digit number
  if (!data.idNumber) {
    data.idNumber = extractIDNumber(lines);
  }

  // Fallback: scan all dates if DOB still empty
  if (!data.dateOfBirth) {
    for (const line of lines) {
      const d = extractDate(line);
      if (d) { data.dateOfBirth = d; break; }
    }
  }

  // Always return whatever was found — never throw, never reject
  return { data };
}