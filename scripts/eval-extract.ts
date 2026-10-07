/**
 * Score the extractors on labelled messages. Everything runs locally; nothing is uploaded.
 *
 *   npm run eval                                   # rules on the sample set
 *   npm run eval -- --engine ollama --model qwen3:8b
 *   npm run eval -- --engine both --model qwen3:8b --file evals/my-messages.local.jsonl --name Marcell
 *
 * File format: one JSON object per line, see evals/sample-messages.jsonl. Keep real messages in
 * files ending in .local.jsonl; those are git-ignored so they never get committed.
 */
import { readFileSync } from 'node:fs';
import type { IncomingRecord, OwnerConfidence, Service } from '../src/lib/core/types';
import { DEFAULT_OLLAMA_URL, ollamaExtractor } from '../src/lib/extract/ollama';
import { analyseMessage, emptyStats } from '../src/lib/extract/pipeline';
import { rulesExtractor } from '../src/lib/extract/rules';
import type { Extractor } from '../src/lib/extract/types';

interface Example {
  id: string;
  service: Service;
  sender: string;
  subject?: string;
  text: string;
  receivedAt: string;
  thread?: { sender: string; text: string }[];
  bulk?: boolean;
  fromMe?: boolean;
  expect: { request: boolean; owner?: OwnerConfidence; due?: string | null };
}

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const file = args.get('file') ?? 'evals/sample-messages.jsonl';
const engine = args.get('engine') ?? 'rules';
const model = args.get('model') ?? '';
const url = args.get('url') ?? DEFAULT_OLLAMA_URL;
const me = { name: args.get('name') ?? '', aliases: (args.get('aliases') ?? '').split(',').filter(Boolean) };

const examples: Example[] = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

async function score(extractor: Extractor) {
  let tp = 0, fp = 0, fn = 0, ownerOk = 0, dueOk = 0, invented = 0, ms = 0;
  const misses: string[] = [];
  const stats = emptyStats();
  for (const ex of examples) {
    const rec: IncomingRecord = {
      sourceId: ex.id, kind: 'message', title: ex.subject ?? '', sender: ex.sender, body: ex.text,
      sourceTimestamp: ex.receivedAt, thread: ex.thread, bulk: ex.bulk, fromMe: ex.fromMe,
    };
    const t0 = performance.now();
    // fresh session per message so one failure doesn't switch the whole run to rules
    await analyseMessage(ex.service, rec, { extractor, me, now: new Date(ex.receivedAt) }, stats, { primaryDown: false });
    ms += performance.now() - t0;
    const got = rec.suggestion ?? null;
    if (got && ex.expect.request) {
      tp++;
      if (!ex.expect.owner || got.ownerConfidence === ex.expect.owner) ownerOk++;
      else misses.push(`owner   ${ex.id}: expected ${ex.expect.owner}, got ${got.ownerConfidence}`);
      if ((got.dueAt ?? null) === (ex.expect.due ?? null)) dueOk++;
      else misses.push(`due     ${ex.id}: expected ${ex.expect.due ?? 'none'}, got ${got.dueAt ?? 'none'}`);
      if (got.dueAt && !ex.expect.due) invented++;
    } else if (got) {
      fp++;
      misses.push(`false+  ${ex.id}: "${got.action}"`);
    } else if (ex.expect.request) {
      fn++;
      misses.push(`missed  ${ex.id}: ${ex.text.slice(0, 70)}`);
    }
  }
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
  console.log(`\n== ${extractor.id}${extractor.id === 'ollama' ? ` (${model})` : ''} on ${examples.length} messages ==`);
  console.log(`Requests found (recall):     ${tp}/${tp + fn}  ${pct(tp, tp + fn)}`);
  console.log(`Suggestions correct (prec.): ${tp}/${tp + fp}  ${pct(tp, tp + fp)}`);
  console.log(`Owner right:                 ${pct(ownerOk, tp)}`);
  console.log(`Due date right:              ${pct(dueOk, tp)}   invented dates: ${invented}`);
  console.log(`Avg time per message:        ${Math.round(ms / examples.length)} ms`);
  if (stats.fallbacks) console.log(`!! ${stats.fallbacks} messages fell back to rules: ${stats.lastError}`);
  if (misses.length) console.log('Details:\n  ' + misses.join('\n  '));
}

const engines: Extractor[] = [];
if (engine === 'rules' || engine === 'both') engines.push(rulesExtractor);
if (engine === 'ollama' || engine === 'both') {
  if (!model) throw new Error('Pass --model, e.g. --model qwen3:8b');
  engines.push(ollamaExtractor({ baseUrl: url, model }));
}
for (const e of engines) await score(e);
