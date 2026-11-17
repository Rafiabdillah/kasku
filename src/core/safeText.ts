const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Prefix user-controlled text that spreadsheet apps would otherwise treat as a formula.
 * The leading apostrophe is consumed by Excel/Sheets and is not displayed.
 */
export function sanitizeSpreadsheetText(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function isDangerousSpreadsheetText(value: string): boolean {
  return FORMULA_PREFIX.test(value);
}
