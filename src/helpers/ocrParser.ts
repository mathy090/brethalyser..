// src/helpers/ocrParser.ts
import TextRecognition from "@react-native-ml-kit/text-recognition";
import { type DriverData } from "./constants";

// ─── Field limits matching Zimbabwe licence exactly ───────────────────────────

export const FIELD_LIMITS: Record<keyof DriverData, number> = {
  surname:       20,
  firstName:     30,
  dateOfBirth:   10,
  gender:         1,
  idNumber:      15,
  licenceNumber: 10,
  licenceCode:    4,
  issueDate:     10,
  expiryDate:    10,
};

// ─── Validators ───────────────────────────────────────────────────────────────

export function isValidZimID(id: string): boolean {
  // Format: 01/232006083Z04 — 2digits / up-to-9digits+letter+2digits
  return /^\d{2}\/\d{6,9}[A-Z]\d{2}$/i.test(id.trim());
}

export function isValidDate(d: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(d.trim());
}

export function isValidLicenceNumber(n: string): boolean {
  // Format: AA00625325 — 1-3 letters then 5-10 digits
  return /^[A-Z]{1,3}\d{5,10}$/i.test(n.trim());
}

// ─── Text cleaner ─────────────────────────────────────────────────────────────
// ML Kit returns noisy OCR — normalise before parsing

function cleanText(raw: string): string {
  return raw
    .replace(/[""'']/g, "")           // smart quotes
    .replace(/[|\\]/g, "/")           // pipe/backslash often misread as slash
    .replace(/\r/g, "\n")             // normalise line endings
    .replace(/[ \t]+/g, " ")          // collapse spaces/tabs
    .trim();
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export interface OCRResult {
  data: Partial<DriverData>;
  confident: boolean;
  missingFields: string[];
  extracted: string[];
}

export function parseOCRText(rawText: string): OCRResult {
  const cleaned  = cleanText(rawText);
  const lines    = cleaned.split(/\n/).map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(" ");
  const data: Partial<DriverData> = {};
  const extracted: string[] = [];

  // ── Strategy 1: label-based extraction ──────────────────────────────────
  // Looks for the label on a line, then takes value from:
  //   a) right of the colon on the same line
  //   b) the next line if nothing follows the colon
  //   c) two lines ahead (ML Kit sometimes inserts blank lines)

  function rightOf(labelPattern: RegExp): string {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!labelPattern.test(line)) continue;

      // value on same line after colon
      const colonIdx = line.lastIndexOf(":");
      if (colonIdx !== -1) {
        const right = line.slice(colonIdx + 1).trim();
        if (right.length > 0) return right;
      }

      // value on next line
      const next = lines[i + 1];
      if (next && next.trim().length > 0) return next.trim();

      // value two lines ahead (blank line inserted by OCR)
      const next2 = lines[i + 2];
      if (next2 && next2.trim().length > 0) return next2.trim();
    }
    return "";
  }

  // ── 1. Surname ──────────────────────────────────────────────────────────
  const surnameRaw = rightOf(/\b1[.\s]*surname/i);
  if (surnameRaw) {
    // keep only English letters, hyphens, apostrophes
    const clean = surnameRaw
      .replace(/[^A-Za-z\-']/g, " ")
      .trim()
      .split(/\s+/)[0] ?? "";
    if (clean.length > 1) {
      data.surname = toTitleCase(clean).slice(0, FIELD_LIMITS.surname);
      extracted.push("surname");
    }
  }

  // ── 2. Name (first + middle) ────────────────────────────────────────────
  const nameRaw = rightOf(/\b2[.\s]*name/i);
  if (nameRaw) {
    const clean = nameRaw
      .replace(/[^A-Za-z\s\-']/g, " ")
      .trim();
    if (clean.length > 1) {
      data.firstName = toTitleCase(clean).slice(0, FIELD_LIMITS.firstName);
      extracted.push("firstName");
    }
  }

  // ── 3. Date of Birth + Gender ────────────────────────────────────────────
  const dobRaw    = rightOf(/\b3[.\s]*date\s*of\s*birth/i);
  const dobMatch  = dobRaw.match(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);
  if (dobMatch?.[1]) {
    data.dateOfBirth = dobMatch[1].replace(/[.\-]/g, "/");
    extracted.push("dateOfBirth");
  }
  const genderMatch = dobRaw.match(/\b(M|F)\b/i);
  if (genderMatch?.[1]) {
    data.gender = genderMatch[1].toUpperCase() as "M" | "F";
    extracted.push("gender");
  }

  // ── 4d. ID Number ────────────────────────────────────────────────────────
  // Real format: 01/232006083Z04
  // ML Kit may read slash as | or \, letter may be misread
  const idRaw  = rightOf(/\b4d[.\s]*id\s*number/i);
  const idClean = idRaw.replace(/[|\\]/g, "/").toUpperCase();
  // pattern: 2digits / 6-9digits + letter + 2digits
  const idMatch = idClean.match(/(\d{2}[\/]\d{6,9}[A-Z]\d{2})/);
  if (idMatch?.[1]) {
    data.idNumber = idMatch[1].slice(0, FIELD_LIMITS.idNumber);
    extracted.push("idNumber");
  }

  // ── 4a,b/11 Validity: issue date — expiry date ───────────────────────────
  const validRaw   = rightOf(/4a[,.\s]*b[\/]?11\s*validity|validity/i);
  const validDates = [...validRaw.matchAll(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/g)]
    .map(m => m[1]!.replace(/[.\-]/g, "/"));
  if (validDates.length >= 2) {
    data.issueDate  = validDates[0]!;
    data.expiryDate = validDates[1]!;
    extracted.push("issueDate", "expiryDate");
  } else if (validDates.length === 1) {
    data.issueDate = validDates[0]!;
    extracted.push("issueDate");
  }

  // ── 5. Licence No ────────────────────────────────────────────────────────
  // Real format: AA00625325
  const licRaw   = rightOf(/\b5[.\s]*licen[cs]e?\s*(no|number|nr)?/i);
  const licMatch = licRaw.match(/([A-Z]{1,3}\d{5,10})/i);
  if (licMatch?.[1]) {
    data.licenceNumber = licMatch[1].toUpperCase().slice(0, FIELD_LIMITS.licenceNumber);
    extracted.push("licenceNumber");
  }

  // ── 9. Code (SADC licence codes) ─────────────────────────────────────────
  const codeRaw   = rightOf(/\b9[.\s]*code/i);
  const codeMatch = codeRaw.match(/\b(A1?|B1?E?|BE|C1?E?|CE|D1?E?|DE)\b/i)
                 ?? codeRaw.match(/\b([A-D]\d?E?)\b/i)
                 ?? codeRaw.match(/\b([1-9])\b/);
  if (codeMatch?.[1]) {
    data.licenceCode = codeMatch[1].toUpperCase().slice(0, FIELD_LIMITS.licenceCode);
    extracted.push("licenceCode");
  }

  // ── 10. First Issue (fallback if validity section not found) ─────────────
  if (!data.issueDate) {
    const firstIssueRaw = rightOf(/\b10[.\s]*first\s*issue/i);
    const fi = firstIssueRaw.match(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);
    if (fi?.[1]) {
      data.issueDate = fi[1].replace(/[.\-]/g, "/");
      extracted.push("issueDate");
    }
  }

  // ── Strategy 2: full-text fallback regex ─────────────────────────────────
  // If label-based extraction missed fields, scan the entire text blob.
  // This handles cases where ML Kit merges or reorders lines.

  // ID number fallback — scan whole text
  if (!data.idNumber) {
    const idFb = fullText.replace(/[|\\]/g, "/")
      .match(/\b(\d{2}\/\d{6,9}[A-Z]\d{2})\b/i);
    if (idFb?.[1]) {
      data.idNumber = idFb[1].toUpperCase().slice(0, FIELD_LIMITS.idNumber);
      extracted.push("idNumber");
    }
  }

  // Licence number fallback
  if (!data.licenceNumber) {
    const licFb = fullText.match(/\b([A-Z]{2}\d{8})\b/i);
    if (licFb?.[1]) {
      data.licenceNumber = licFb[1].toUpperCase().slice(0, FIELD_LIMITS.licenceNumber);
      extracted.push("licenceNumber");
    }
  }

  // Date fallback — collect all dates, assign by position
  if (!data.dateOfBirth || !data.issueDate || !data.expiryDate) {
    const allDates = [...fullText.matchAll(/\b(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})\b/g)]
      .map(m => m[1]!.replace(/[.\-]/g, "/"))
      .filter((v, i, arr) => arr.indexOf(v) === i); // dedupe

    // Heuristic: DOB is typically oldest date, issue/expiry are recent
    if (!data.dateOfBirth && allDates.length >= 1) {
      const sorted = [...allDates].sort((a, b) => {
        const toMs = (d: string) => {
          const [dd, mm, yyyy] = d.split("/");
          return new Date(`${yyyy}-${mm}-${dd}`).getTime();
        };
        return toMs(a) - toMs(b);
      });
      if (!data.dateOfBirth) { data.dateOfBirth = sorted[0]!; extracted.push("dateOfBirth"); }
      if (!data.issueDate  && sorted[1]) { data.issueDate  = sorted[1]!; extracted.push("issueDate"); }
      if (!data.expiryDate && sorted[2]) { data.expiryDate = sorted[2]!; extracted.push("expiryDate"); }
    }
  }

  // Gender fallback — look for standalone M or F near DOB area
  if (!data.gender) {
    const gFb = fullText.match(/\b(21\/\d{2}\/\d{4})\s+(M|F)\b/i)
             ?? fullText.match(/\b(M|F)\b(?=\s|$)/i);
    if (gFb) {
      // pick the capture group that is M or F
      const g = gFb[2] ?? gFb[1] ?? "";
      if (g === "M" || g === "F") {
        data.gender = g as "M" | "F";
        extracted.push("gender");
      }
    }
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const REQUIRED = [
    { key: "surname",     pattern: /\b1[.\s]*surname/i },
    { key: "name",        pattern: /\b2[.\s]*name/i },
    { key: "dateOfBirth", pattern: /\b3[.\s]*date\s*of\s*birth/i },
    { key: "idNumber",    pattern: /\b4d[.\s]*id\s*number/i },
    { key: "licenceNo",   pattern: /\b5[.\s]*licen[cs]e?\s*(no|number|nr)?/i },
    { key: "code",        pattern: /\b9[.\s]*code/i },
  ];
  const missingFields = REQUIRED
    .filter(({ pattern }) => !pattern.test(fullText))
    .map(({ key }) => key);

  return {
    data,
    confident:     extracted.length >= 4,
    missingFields,
    extracted,
  };
}

// ─── ML Kit bridge ────────────────────────────────────────────────────────────

export async function parseDriverLicence(photoUri: string): Promise<DriverData> {
  const result = await TextRecognition.recognize(photoUri);
  const { data } = parseOCRText(result.text);
  return {
    surname:       data.surname       ?? "",
    firstName:     data.firstName     ?? "",
    dateOfBirth:   data.dateOfBirth   ?? "",
    gender:        data.gender        ?? "",
    idNumber:      data.idNumber      ?? "",
    licenceNumber: data.licenceNumber ?? "",
    licenceCode:   data.licenceCode   ?? "",
    issueDate:     data.issueDate     ?? "",
    expiryDate:    data.expiryDate    ?? "",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)[a-z]/g, c => c.toUpperCase());
}