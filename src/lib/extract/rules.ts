import type { OwnerConfidence, Suggestion } from '../core/types';
import { findDue } from './due';
import type { ExtractInput, Extractor, Me } from './types';

/**
 * Keyword fallback, used when no model is configured or Ollama is unreachable.
 * Deliberately conservative: it only flags sentences phrased as a request.
 */
const REQUEST_PATTERNS: RegExp[] = [
  /\b(?:can|could|would|will) you(?: please| pls| maybe)?\s+(.+)/i,
  /\b(?:please|pls|plz)\s+(.+)/i,
  /\b(?:i|we) (?:need|want|would like) you to\s+(.+)/i,
  /\bwould you mind\s+(.+)/i,
  /\b(?:are you able|any chance you could|do you have time) to\s+(.+)/i,
  /\b(?:someone|somebody|anyone|one of you) (?:needs to|has to|should|must|could)\s+(.+)/i,
];

const GROUP_ADDRESS = /\b(someone|somebody|anyone|any of you|one of you|everyone|you guys|you all|y'all|team)\b|\byou or [A-Z]\w+|\b[A-Z]\w+ or you\b/;

function sentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mentionsOther(sentence: string, me: Me): boolean {
  const mention = /@([\w.-]+)/.exec(sentence);
  if (!mention) return false;
  const handle = mention[1].toLowerCase();
  const mine = [me.name, ...me.aliases].map((a) => a.toLowerCase().replace(/^@/, ''));
  return !mine.some((m) => m && handle.startsWith(m));
}

function toAction(fragment: string): string {
  let a = fragment
    .replace(/[?!.…🙏]+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (a.length > 90) a = a.slice(0, 87).replace(/\s+\S*$/, '') + '…';
  return a.charAt(0).toUpperCase() + a.slice(1);
}

export function extractWithRules(input: ExtractInput): Suggestion | null {
  for (const sentence of sentences(input.text)) {
    for (const re of REQUEST_PATTERNS) {
      const m = re.exec(sentence);
      if (!m) continue;
      if (mentionsOther(sentence, input.me)) return null; // "@alex can you…": not for the user
      const owner: OwnerConfidence = GROUP_ADDRESS.test(sentence) ? 'unclear' : 'me';
      const due = findDue(sentence, input.receivedAt) ?? findDue(input.text, input.receivedAt);
      const where = input.service === 'slack' ? 'a DM' : 'an email';
      return {
        action: toAction(m[1]),
        reason:
          owner === 'me'
            ? `Phrased as a request to you in ${where}`
            : `Request in ${where}, but addressed to more than one person`,
        ownerConfidence: owner,
        dueAt: due?.date ?? null,
        evidence: sentence,
        extractedBy: 'rules',
      };
    }
  }
  return null;
}

export const rulesExtractor: Extractor = {
  id: 'rules',
  extract: async (input) => extractWithRules(input),
};
