import type { IncomingRecord, Service } from '../core/types';
import { skipReason } from './prefilter';
import { rulesExtractor } from './rules';
import type { Extractor, Me } from './types';

export interface ExtractionStats {
  analysed: number;
  skipped: number;
  suggested: number;
  /** Messages handled by the rules fallback because the primary extractor failed. */
  fallbacks: number;
  lastError: string | null;
}

export function emptyStats(): ExtractionStats {
  return { analysed: 0, skipped: 0, suggested: 0, fallbacks: 0, lastError: null };
}

/**
 * Analyses one new message in place: sets `rec.suggestion` to a Suggestion or null.
 * Pre-filter first, then the primary extractor, then rules if the primary one fails.
 * After a primary failure the rest of the run uses rules directly (no point waiting on
 * a timeout for every message while Ollama is down); `session` carries that state.
 */
export async function analyseMessage(
  service: Service,
  rec: IncomingRecord,
  ctx: { extractor: Extractor; me: Me; now: Date },
  stats: ExtractionStats,
  session: { primaryDown: boolean } = { primaryDown: false },
): Promise<void> {
  if (skipReason(rec)) {
    rec.suggestion = null;
    stats.skipped++;
    return;
  }
  const input = {
    service,
    sender: rec.sender ?? 'Unknown',
    subject: rec.title,
    text: (rec.body ?? rec.excerpt ?? '').trim(),
    receivedAt: rec.sourceTimestamp ?? ctx.now.toISOString(),
    thread: rec.thread ?? [],
    me: ctx.me,
  };
  stats.analysed++;
  const primary = session.primaryDown ? rulesExtractor : ctx.extractor;
  try {
    rec.suggestion = await primary.extract(input);
    if (session.primaryDown && ctx.extractor.id !== 'rules') stats.fallbacks++;
  } catch (e) {
    stats.lastError = e instanceof Error ? e.message : String(e);
    stats.fallbacks++;
    session.primaryDown = true;
    rec.suggestion = await rulesExtractor.extract(input);
  }
  if (rec.suggestion) stats.suggested++;
}
