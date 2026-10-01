import type { IncomingRecord } from '../core/types';

/**
 * Cheap checks that skip messages before any extractor (and especially before a slow local
 * model) looks at them. Returns a reason when the message can't be a request for the user.
 */
const AUTOMATED_SENDER = /(^|[^a-z])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|digest|calendar-notification|bounce)([^a-z]|$)/i;
const SMALL_TALK = /^(ok(ay)?|k|thanks?( you)?|thx|ty|cheers|great|nice|cool|lol|haha+|👍|🙏|❤️|sounds good|got it|perfect|sure|yes|no|yep|nope)[\s.!]*$/i;
const CALENDAR = /^(invitation|updated invitation|accepted|declined|tentative|canceled event|cancelled event)\b.*@/i;

export function skipReason(rec: Pick<IncomingRecord, 'fromMe' | 'bulk' | 'sender' | 'title' | 'body' | 'excerpt'>): string | null {
  if (rec.fromMe) return 'sent by you';
  if (rec.bulk) return 'bulk or automated mail';
  if (rec.sender && AUTOMATED_SENDER.test(rec.sender)) return 'automated sender';
  if (CALENDAR.test(rec.title)) return 'calendar notification';
  const text = (rec.body ?? rec.excerpt ?? '').trim();
  if (!text) return 'empty message';
  if (text.length < 40 && SMALL_TALK.test(text)) return 'small talk';
  return null;
}
