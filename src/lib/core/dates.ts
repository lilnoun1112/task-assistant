const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Local calendar day ('YYYY-MM-DD') of a date-only string or ISO timestamp. */
export function dayKey(value: string | Date): string {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** Start of the given local day, `offset` days later. */
export function startOfDay(d: Date, offset = 0): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return r;
}

/** Sortable instant for a due value; date-only dues sort at the end of their day. */
export function dueInstant(value: string): number {
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).getTime();
  }
  return new Date(value).getTime();
}

export function formatDue(value: string, now: Date): string {
  const key = dayKey(value);
  const today = dayKey(now);
  const tomorrow = dayKey(addDays(now, 1));
  const yesterday = dayKey(addDays(now, -1));
  let day: string;
  if (key === today) day = 'Today';
  else if (key === tomorrow) day = 'Tomorrow';
  else if (key === yesterday) day = 'Yesterday';
  else {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    day = date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(y !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  }
  if (isDateOnly(value)) return day;
  const time = new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

export function formatRelative(iso: string, now: Date): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDue(iso, now);
}
