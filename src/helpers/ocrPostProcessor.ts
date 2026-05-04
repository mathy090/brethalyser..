// src/helpers/ocrPostProcessor.ts
import { type DriverData } from "./constants";

export function postProcess(data: Partial<DriverData>): DriverData {
  return {
    surname:       cleanName(data.surname),
    firstName:     cleanName(data.firstName),
    dateOfBirth:   cleanDate(data.dateOfBirth),
    gender:        cleanGender(data.gender),
    idNumber:      cleanIdNumber(data.idNumber),
    licenceNumber: cleanLicenceNumber(data.licenceNumber),
    licenceCode:   cleanCode(data.licenceCode),
    issueDate:     cleanDate(data.issueDate),
    expiryDate:    cleanDate(data.expiryDate),
  };
}

function cleanName(v: string | undefined): string {
  return (v || "")
    .replace(/[^A-Z\s'-]/gi, "")  // Keep letters, spaces, hyphens, apostrophes
    .replace(/\s+/g, " ")          // Collapse whitespace
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()); // Title case first letters
}

function cleanDate(v: string | undefined): string {
  const cleaned = (v || "").replace(/[.\-]/g, "/");
  // Validate format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
    const [d, m, y] = cleaned.split("/").map(Number);
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d) {
      return cleaned;
    }
  }
  return "";
}

function cleanGender(v: string | undefined): "M" | "F" | "" {
  const g = (v || "").toUpperCase().trim();
  return g === "M" || g === "F" ? g : "";
}

function cleanIdNumber(v: string | undefined): string {
  return (v || "")
    .replace(/[|\\]/g, "/")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim()
    .slice(0, 20);
}

function cleanLicenceNumber(v: string | undefined): string {
  return (v || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .trim()
    .slice(0, 12);
}

function cleanCode(v: string | undefined): string {
  return (v || "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .trim()
    .slice(0, 4);
}

// ─── Multi-Frame Watermark Suppression ───────────────────────────────────
export function mergeFrames(frames: string[]): string {
  const wordMap = new Map<string, number>();
  
  frames.forEach(text => {
    const words = text
      .split(/\s+/)
      .filter(w => w.length >= 2)                    // Skip tiny noise
      .filter(w => !/[©™®]/i.test(w))                // Skip watermark symbols
      .map(w => w.toUpperCase());
    
    words.forEach(word => {
      wordMap.set(word, (wordMap.get(word) || 0) + 1);
    });
  });

  // Keep words appearing in >= 3 frames (configurable)
  const threshold = 3;
  return Array.from(wordMap.entries())
    .filter(([_, count]) => count >= threshold)
    .map(([word]) => word)
    .join(" ");
}

// ─── Spatial Stability Filter (Center ROI Bias) ─────────────────────────
export function filterByPosition(
  words: Array<{ text: string; x: number; y: number; width: number; height: number }>,
  imageWidth: number,
  imageHeight: number
): string {
  // Define center region (ignore edges where watermarks live)
  const marginX = imageWidth * 0.15;
  const marginY = imageHeight * 0.15;
  
  const centerWords = words.filter(w => 
    w.x > marginX && 
    w.x + w.width < imageWidth - marginX &&
    w.y > marginY && 
    w.y + w.height < imageHeight - marginY
  );
  
  return centerWords.map(w => w.text).join(" ");
}