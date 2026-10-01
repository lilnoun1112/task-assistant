import { addDays, dayKey } from '../core/dates';

/**
 * Deterministic deadline parsing. The only code allowed to turn words into a due date:
 * language models may point at deadline wording, but the date itself always comes from here,
 * so a date is never invented. Anything ambiguous ("the 15th", "10/11", "soon") yields null.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

export interface DueMatch {
  /** 'YYYY-MM-DD' */
  date: string;
  /** The words it came from, as written in the message. */
  text: string;
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

function validDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

/** A month/day without a year: this year, or next year if that date is long gone. */
function nearestYear(m: number, d: number, received: Date): Date | null {
  const thisYear = validDate(received.getFullYear(), m, d);
  if (!thisYear) return null;
  if (thisYear.getTime() < addDays(received, -60).getTime()) return validDate(received.getFullYear() + 1, m, d);
  return thisYear;
}

type Rule = { re: RegExp; resolve: (m: RegExpExecArray, received: Date) => Date | null };

const RULES: Rule[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, resolve: (m) => validDate(+m[1], +m[2] - 1, +m[3]) },
  {
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'),
    resolve: (m, r) => nearestYear(monthIndex(m[1]), +m[2], r),
  },
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'i'),
    resolve: (m, r) => nearestYear(monthIndex(m[2]), +m[1], r),
  },
  { re: /\b(?:today|tonight|this evening|by (?:the )?end of (?:the )?day|eod|cob)\b/i, resolve: (_m, r) => r },
  { re: /\btomorrow\b/i, resolve: (_m, r) => addDays(r, 1) },
  {
    re: /\b(next|this|by|on|before|until|till|due)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    resolve: (m, r) => {
      const target = WEEKDAYS.indexOf(m[2].toLowerCase());
      let diff = (target - r.getDay() + 7) % 7; // upcoming occurrence; same day counts
      if (m[1]?.toLowerCase() === 'next') diff = diff === 0 ? 7 : diff + 7;
      return addDays(r, diff);
    },
  },
];

/** Earliest-positioned deadline expression in `text`, resolved against when the message arrived. */
export function findDue(text: string, receivedAt: string | Date): DueMatch | null {
  const received = typeof receivedAt === 'string' ? new Date(receivedAt) : receivedAt;
  let best: (DueMatch & { index: number }) | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const date = rule.resolve(m, received);
    if (!date) continue;
    if (!best || m.index < best.index) best = { date: dayKey(date), text: m[0].trim(), index: m.index };
  }
  return best ? { date: best.date, text: best.text } : null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?…-]+|[\s.,;:!?…-]+$/g, '');
}

/** Whether `quote` really appears in `text` (case/whitespace/quote-insensitive). */
export function containsQuote(text: string, quote: string | null | undefined): boolean {
  if (!quote) return false;
  const q = normalize(quote);
  return q.length > 0 && normalize(text).includes(q);
}
