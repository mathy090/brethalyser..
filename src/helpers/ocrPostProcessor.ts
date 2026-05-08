import { type DriverData } from "./constants";

// ─── Safety Helpers ────────────────────────────────────────────────────────
function safe(v: string | undefined | null): string {
  return (v || "").trim();
}

function cleanName(name: string): string {
  return safe(name)
    .replace(/[^\w\s'-]/g, " ") // Remove weird OCR artifacts
    .replace(/\s+/g, " ")        // Collapse multiple spaces
    .trim();
}

function cleanId(id: string): string {
  return safe(id)
    .replace(/\s/g, "")          // Remove spaces
    .replace(/[Oo]/g, "0")       // Common OCR: O → 0
    .replace(/[Ii]/g, "1")       // Common OCR: I → 1
    .toUpperCase();
}

function cleanLicenceNumber(num: string): string {
  return safe(num)
    .replace(/\s/g, "")
    .replace(/[Oo]/g, "0")
    .replace(/[Ii]/g, "1")
    .toUpperCase();
}

function cleanCode(code: string): string {
  return safe(code)
    .replace(/\s/g, "")
    .toUpperCase()
    .slice(0, 4); // Max length per FIELD_LIMITS
}

function formatDate(date: string): string {
  const d = safe(date);
  // If already DD/MM/YYYY format, return as-is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  // Fallback: return cleaned input
  return d.replace(/[^\d\/]/g, "").slice(0, 10);
}

// ─── Main Post-Processor ───────────────────────────────────────────────────
export function postProcess(data: Partial<DriverData>): Partial<DriverData> {
  return {
    surname: cleanName(data.surname),
    firstName: cleanName(data.firstName),
    dateOfBirth: formatDate(data.dateOfBirth),
    gender: (data.gender?.toUpperCase() === "M" || data.gender?.toUpperCase() === "F")
      ? (data.gender.toUpperCase() as "M" | "F")
      : "",
    idNumber: cleanId(data.idNumber),
    licenceNumber: cleanLicenceNumber(data.licenceNumber),
    licenceCode: cleanCode(data.licenceCode),
    issueDate: formatDate(data.issueDate),
    expiryDate: formatDate(data.expiryDate),
  };
}