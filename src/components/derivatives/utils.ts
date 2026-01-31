// Utility functions for derivatives components

// Format expiry as MMM/YY (e.g., DIC/27, FEB/26) - Italian months
export function formatExpiryMMY(date: string | null | undefined): string {
  if (!date) return '-';
  const months = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const d = new Date(date);
  const month = months[d.getMonth()];
  const year = d.getFullYear().toString().slice(-2);
  return `${month}/${year}`;
}

// Normalize underlying names for matching
export function normalizeForMatching(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bAZ\.\s*/gi, '')
    .replace(/\bAZ\s*/gi, '')
    .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|CO|COMPANY|CLASS\s*[A-Z]?|CL\s*[A-Z]?|COMMON|STOCK|ORD|ORDINARY|ADR|SPA|AG|SA|NV|PLC)\b/gi, '')
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}
