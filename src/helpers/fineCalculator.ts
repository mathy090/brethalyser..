/**
 * src/helpers/fineCalculator.ts
 * 
 * Calculates traffic fines based on BAC levels according to Zimbabwe Road Traffic Act guidelines.
 * Values are illustrative and should be updated with official legal tables.
 */

export interface FineBracket {
  minBac: number;
  maxBac: number;
  fineAmount: number; // In ZWL or USD
  description: string;
}

// Define your fine brackets here
const FINE_BRACKETS: FineBracket[] = [
  { minBac: 0.00, maxBac: 0.05, fineAmount: 0, description: "Within Legal Limit" },
  { minBac: 0.05, maxBac: 0.08, fineAmount: 500, description: "Minor Infraction" },
  { minBac: 0.08, maxBac: 0.15, fineAmount: 1500, description: "Over Legal Limit" },
  { minBac: 0.15, maxBac: 0.25, fineAmount: 3500, description: "High Intoxication" },
  { minBac: 0.25, maxBac: 1.00, fineAmount: 5000, description: "Severe Intoxication" },
];

export const calculateFine = (bacPercent: number): { amount: number; description: string } => {
  // Find the bracket where the BAC fits
  const bracket = FINE_BRACKETS.find(
    (b) => bacPercent >= b.minBac && bacPercent < b.maxBac
  );

  // Default to highest bracket if over max defined limit
  if (!bracket) {
    const highest = FINE_BRACKETS[FINE_BRACKETS.length - 1];
    return { amount: highest.fineAmount, description: highest.description };
  }

  return { amount: bracket.fineAmount, description: bracket.description };
};