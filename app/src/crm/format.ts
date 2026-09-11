/**
 * Display helpers. Everything the CRM prints goes through one of these, so
 * that ₹ and dates look the same on every screen.
 *
 * Money arrives as integer paise and is divided by 100 exactly once, here, at
 * the edge. Nothing upstream of this file has a rupee in it.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const RUPEES_PLAIN = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DAY = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DAY_SHORT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });

const STAMP = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `5_850_000` -> `₹58,500`. Paise are never shown; the desk rounds to rupees. */
export function money(minor: number): string {
  return RUPEES.format(Math.round(minor / 100));
}

/** The same number without the symbol, for a column that already has one. */
export function amount(minor: number): string {
  return RUPEES_PLAIN.format(Math.round(minor / 100));
}

/**
 * A plain calendar date is parsed as UTC by `new Date('2026-10-02')`, so it is
 * rendered with an explicit UTC timezone. Formatting it in the browser's zone
 * would show 01 Oct to anyone west of Greenwich, and a departure date that
 * moves depending on who is looking at it is a support call.
 */
export function date(iso: string): string {
  return DAY.format(new Date(`${iso}T00:00:00Z`));
}

export function dateShort(iso: string): string {
  return DAY_SHORT.format(new Date(`${iso}T00:00:00Z`));
}

/** An instant with an offset, e.g. a `sourceUpdatedAt`. */
export function timestamp(iso: string): string {
  return STAMP.format(new Date(iso));
}

/** `2026-10-02` + `2026-10-10` -> `02 Oct – 10 Oct 2026`. */
export function dateRange(startIso: string, endIso: string): string {
  const startYear = startIso.slice(0, 4);
  const endYear = endIso.slice(0, 4);
  if (startYear === endYear) {
    return `${dateShort(startIso)} – ${date(endIso)}`;
  }
  return `${date(startIso)} – ${date(endIso)}`;
}

/** Whole days from today to a calendar date; negative once it is past. */
export function daysUntil(iso: string): number {
  const target = Date.parse(`${iso}T00:00:00Z`);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

/** `Meera Sharma` -> `MS`, for the masthead badge. */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** `PAID_IN_FULL` -> `Paid in full`, for anything the desk reads rather than sorts by. */
export function humanise(token: string): string {
  const words = token.toLowerCase().split('_');
  const [head, ...rest] = words;
  if (head === undefined) return token;
  return [head.charAt(0).toUpperCase() + head.slice(1), ...rest].join(' ');
}
