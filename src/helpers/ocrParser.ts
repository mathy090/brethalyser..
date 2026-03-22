import { type DriverData } from "./constants";

export interface OCRResult {
  data: Partial<DriverData>;
  confident: boolean;
  missingFields: string[];
  extracted: string[];
}

export function parseOCRText(rawText: string): OCRResult {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);
  const data: Partial<DriverData> = {};
  const extracted: string[] = [];

  function rightOf(labelPattern: RegExp): string {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!labelPattern.test(line)) continue;
      const colonIdx = line.lastIndexOf(":");
      if (colonIdx !== -1) {
        const right = line.slice(colonIdx + 1).trim();
        if (right.length > 0) return right;
      }
      const next = lines[i + 1];
      if (next && !next.includes(":")) return next.trim();
    }
    return "";
  }

  // 1. Surname
  const surnameRight = rightOf(/\b1[.\s]+surname/i);
  if (surnameRight) {
    const clean = surnameRight.replace(/[^A-Za-z\-']/g, " ").trim().split(/\s+/)[0] ?? "";
    if (clean.length > 1) { data.surname = toTitleCase(clean); extracted.push("surname"); }
  }

  // 2. Name
  const nameRight = rightOf(/\b2[.\s]+name/i);
  if (nameRight) {
    const clean = nameRight.replace(/[^A-Za-z\s\-']/g, " ").trim();
    if (clean.length > 1) { data.firstName = toTitleCase(clean); extracted.push("firstName"); }
  }

  // 3. Date of Birth + Gender
  const dobRight = rightOf(/\b3[.\s]+date\s*of\s*birth/i);
  const dobMatch = dobRight.match(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);
  if (dobMatch?.[1]) { data.dateOfBirth = dobMatch[1].replace(/[.\-]/g, "/"); extracted.push("dateOfBirth"); }
  const genderMatch = dobRight.match(/\b(M|F)\b/);
  if (genderMatch?.[1]) { data.gender = genderMatch[1].toUpperCase() as "M" | "F"; extracted.push("gender"); }

  // 4d. ID Number
  const idRight = rightOf(/\b4d[.\s]+id\s*number/i);
  const idMatch = idRight.match(/(\d{2}[\/\-]\d{6,9}[A-Z]\d{2})/i) || idRight.match(/(\d{2}[\/\-]\d{6}[A-Z]\d{2})/i);
  if (idMatch?.[1]) { data.idNumber = idMatch[1].toUpperCase(); extracted.push("idNumber"); }

  // 4a,b/11 Validity
  const validRight = rightOf(/4a[,.]?b[\/]?11\s*validity|validity/i);
  const validDates = [...validRight.matchAll(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/g)].map(m => m[1]!.replace(/[.\-]/g, "/"));
  if (validDates.length >= 2) { data.issueDate = validDates[0]!; data.expiryDate = validDates[1]!; extracted.push("issueDate", "expiryDate"); }
  else if (validDates.length === 1) { data.issueDate = validDates[0]!; extracted.push("issueDate"); }

  // 5. Licence No
  const licRight = rightOf(/\b5[.\s]+licen[cs]e?\s*(no|number|nr)/i);
  const licMatch = licRight.match(/([A-Z]{1,3}\d{5,10})/i);
  if (licMatch?.[1]) { data.licenceNumber = licMatch[1].toUpperCase(); extracted.push("licenceNumber"); }

  // 9. Code
  const codeRight = rightOf(/\b9[.\s]+code/i);
  const codeMatch = codeRight.match(/\b(A1?|B1?E?|BE|C1?E?|CE|D1?E?|DE)\b/i) || codeRight.match(/\b([1-9])\b/);
  if (codeMatch?.[1]) { data.licenceCode = codeMatch[1].toUpperCase(); extracted.push("licenceCode"); }

  // 10. First Issue
  if (!data.issueDate) {
    const firstIssueRight = rightOf(/\b10[.\s]+first\s*issue/i);
    const fi = firstIssueRight.match(/(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/);
    if (fi?.[1]) { data.issueDate = fi[1].replace(/[.\-]/g, "/"); extracted.push("issueDate"); }
  }

  const fullText = lines.join(" ");
  const REQUIRED_LABELS = [
    { key: "surname",     pattern: /\b1[.\s]+surname/i },
    { key: "name",        pattern: /\b2[.\s]+name/i },
    { key: "dateOfBirth", pattern: /\b3[.\s]+date\s*of\s*birth/i },
    { key: "idNumber",    pattern: /\b4d[.\s]+id\s*number/i },
    { key: "licenceNo",   pattern: /\b5[.\s]+licen[cs]e?\s*(no|number|nr)/i },
    { key: "code",        pattern: /\b9[.\s]+code/i },
  ];
  const missingFields = REQUIRED_LABELS
    .filter(({ pattern }) => !pattern.test(fullText))
    .map(({ key }) => key);

  // Always confident — return whatever was found, let officer review
  const confident = extracted.length > 0;

  return { data, confident, missingFields, extracted };
}

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|\s|-)[a-z]/g, c => c.toUpperCase());
}