// Basic PHI guard. Detects and masks common identifiers before text is sent to an AI model.
// This is a first safety layer, not a full de-identification system.
const PATTERNS = [
  { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'MRN', re: /\b(?:MRN|medical record(?: number)?)[:#\s]*[A-Z0-9-]{4,}\b/gi },
  { type: 'DATE_OF_BIRTH', re: /\b(?:DOB|date of birth)[:\s]*\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/gi },
  { type: 'PHONE', re: /\b(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { type: 'EMAIL', re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'MEDICARE_ID', re: /\b\d[A-Z][A-Z0-9]\d[A-Z][A-Z0-9]\d[A-Z]{2}\d{2}\b/g }
];

export function scrubPHI(text = '') {
  const findings = [];
  let clean = String(text);
  for (const { type, re } of PATTERNS) {
    clean = clean.replace(re, (match) => {
      findings.push(type);
      return `[REDACTED-${type}]`;
    });
  }
  return { clean, findings: [...new Set(findings)], redactions: findings.length };
}
