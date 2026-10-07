import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TaskRepository } from '../src/lib/core/repo';
import type { IncomingRecord } from '../src/lib/core/types';
import { bucketOf } from '../src/lib/core/views';
import { migrate } from '../src/lib/db/migrations';
import { containsQuote, findDue } from '../src/lib/extract/due';
import { ollamaDigest, ollamaExtractor, ollamaModels, validateExtraction } from '../src/lib/extract/ollama';
import { skipReason } from '../src/lib/extract/prefilter';
import { extractWithRules } from '../src/lib/extract/rules';
import type { ExtractInput, Extractor } from '../src/lib/extract/types';
import { runSync, type Connector } from '../src/lib/sync/engine';
import { sampleConnectors } from '../src/lib/sync/sample';
import { openNodeDb } from './nodeDb';

const RECEIVED = new Date(2026, 9, 1, 9, 0); // Thu 1 Oct 2026
const me = { name: 'Marcell', aliases: ['marci'] };
const input = (text: string, over: Partial<ExtractInput> = {}): ExtractInput => ({
  service: 'gmail',
  sender: 'Dana',
  subject: 'Re: contract',
  text,
  receivedAt: RECEIVED.toISOString(),
  thread: [],
  me,
  ...over,
});

describe('deadline parsing', () => {
  it.each([
    ['send it by tomorrow', '2026-10-02'],
    ['need this today please', '2026-10-01'],
    ['by EOD', '2026-10-01'],
    ['by Friday', '2026-10-02'],
    ['on Thursday', '2026-10-01'], // same weekday counts as this week
    ['next Monday', '2026-10-12'],
    ['due 2026-11-03', '2026-11-03'],
    ['before Oct 15th', '2026-10-15'],
    ['by 3 November', '2026-11-03'],
    ['in January 5', '2027-01-05'], // past month rolls to next year
  ])('%s → %s', (text, date) => {
    expect(findDue(text, RECEIVED)?.date).toBe(date);
  });

  it.each(['the 15th', 'soon', 'asap', 'by 10/11', 'sometime next week'])('refuses to guess: %s', (text) => {
    expect(findDue(text, RECEIVED)).toBeNull();
  });

  it('matches quotes loosely but not invented text', () => {
    expect(containsQuote('Could you send over the  signed contract?', '"could you send over the signed contract"')).toBe(true);
    expect(containsQuote('Could you send over the contract?', 'send the invoice')).toBe(false);
  });
});

describe('pre-filter', () => {
  it('skips mail that cannot be a request', () => {
    expect(skipReason({ title: 'x', fromMe: true, body: 'can you?' })).toBe('sent by you');
    expect(skipReason({ title: 'x', bulk: true, body: 'please join' })).toBe('bulk or automated mail');
    expect(skipReason({ title: 'x', sender: 'GitHub <noreply@github.com>', body: 'Please review' })).toBe('automated sender');
    expect(skipReason({ title: 'DM', body: 'thanks!' })).toBe('small talk');
    expect(skipReason({ title: 'DM', body: 'can you review my PR today?' })).toBeNull();
  });
});

describe('rules extractor', () => {
  it('finds a direct request with an explicit deadline', () => {
    const s = extractWithRules(input('Hi! Could you send over the signed contract by Friday? Legal needs it.'))!;
    expect(s).toMatchObject({ ownerConfidence: 'me', dueAt: '2026-10-02', extractedBy: 'rules' });
    expect(s.action).toBe('Send over the signed contract by Friday');
    expect(s.evidence).toBe('Could you send over the signed contract by Friday?');
  });

  it('marks group requests as unclear and does not invent dates', () => {
    const s = extractWithRules(input('Someone needs to pick the final photos, maybe you or Alex? Deadline is the 15th.'))!;
    expect(s).toMatchObject({ ownerConfidence: 'unclear', dueAt: null });
  });

  it('ignores chat and requests aimed at someone else', () => {
    expect(extractWithRules(input('haha did you see the new coffee machine'))).toBeNull();
    expect(extractWithRules(input('@alex can you take this one?'))).toBeNull();
    expect(extractWithRules(input('@marcell can you take this one?'))).not.toBeNull();
  });
});

describe('validating model answers', () => {
  const text = 'Could you send over the signed contract by Friday? Legal needs it before the kickoff.';
  const raw = (over: Record<string, unknown> = {}) => ({
    is_request: true,
    owner: 'me',
    action: 'Send signed contract to Dana',
    evidence: 'Could you send over the signed contract by Friday?',
    due_text: 'by Friday',
    reason: 'Direct request',
    ...over,
  });

  it('accepts a grounded answer and computes the date itself', () => {
    expect(validateExtraction(raw(), input(text))).toMatchObject({
      action: 'Send signed contract to Dana',
      ownerConfidence: 'me',
      dueAt: '2026-10-02',
      extractedBy: 'ollama',
    });
  });

  it('drops a deadline that is not in the message', () => {
    const s = validateExtraction(raw({ due_text: 'by October 3' }), input(text))!;
    expect(s.dueAt).toBeNull();
    expect(s.reason).toContain('no exact date');
  });

  it('keeps ambiguous deadline wording as a note, not a date', () => {
    const s = validateExtraction(raw({ due_text: 'the 15th' }), input('Can you pick photos? Deadline is the 15th.'))!;
    expect(s.dueAt).toBeNull();
    expect(s.reason).toContain('"the 15th"');
  });

  it('downgrades ownership when the quote is made up', () => {
    const s = validateExtraction(raw({ evidence: 'Please send the contract now' }), input(text))!;
    expect(s).toMatchObject({ ownerConfidence: 'unclear', evidence: null });
  });

  it('returns null for non-requests and for requests to others', () => {
    expect(validateExtraction(raw({ is_request: false }), input(text))).toBeNull();
    expect(validateExtraction(raw({ owner: 'others' }), input(text))).toBeNull();
  });

  it('rejects malformed answers', () => {
    expect(() => validateExtraction({ is_request: 'yes' }, input(text))).toThrow(/expected format/);
  });
});

// ------------------------------------------------------------------ stand-in Ollama server

type Handler = (body: any) => unknown;
let server: Server;
let baseUrl: string;
let handler: Handler;
const requests: any[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.1:8b' }] }));
        return;
      }
      if (req.url === '/api/chat') {
        const body = JSON.parse(data);
        requests.push(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: JSON.stringify(handler(body)) }, done: true }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => (requests.length = 0));

/** A crude "model": treats messages containing "can you"/"could you" as requests and quotes them. */
const fakeModel: Handler = (body) => {
  const user: string = body.messages[1].content;
  const latest = user.split('<<<\n')[1].split('\n>>>')[0];
  const sentence = latest.split(/(?<=[?.!])\s+/).find((s) => /\b(can|could) you\b/i.test(s));
  if (!sentence) return { is_request: false, owner: 'me', action: '', evidence: '', due_text: null, reason: 'No request' };
  const due = /\b(today|by \w+day)\b/i.exec(latest)?.[0] ?? null;
  return {
    is_request: true,
    owner: /you or/i.test(sentence) ? 'unclear' : 'me',
    action: 'Model action: ' + sentence.slice(0, 30),
    evidence: sentence,
    due_text: due,
    reason: 'Asked directly',
  };
};

describe('Ollama client (against a stand-in server)', () => {
  it('lists installed models', async () => {
    expect(await ollamaModels({ baseUrl })).toEqual(['llama3.1:8b', 'qwen3:8b']);
  });

  it('sends a structured-output request and validates the answer', async () => {
    handler = fakeModel;
    const ex = ollamaExtractor({ baseUrl, model: 'qwen3:8b' });
    const s = await ex.extract(
      input('hey! can you review my PR for the pricing page today? 🙏', { service: 'slack', thread: [{ sender: 'Priya', text: 'morning!' }] }),
    );
    expect(s).toMatchObject({ ownerConfidence: 'me', dueAt: '2026-10-01', extractedBy: 'ollama' });
    const [req] = requests;
    expect(req).toMatchObject({ model: 'qwen3:8b', stream: false, options: { temperature: 0 } });
    expect(req.format.required).toContain('is_request');
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[1].content).toContain('Slack direct message');
    expect(req.messages[1].content).toContain('- Priya: morning!');
  });

  it('reports a clear error when Ollama is not running', async () => {
    const ex = ollamaExtractor({ baseUrl: 'http://127.0.0.1:9', model: 'x', timeoutMs: 2000 });
    await expect(ex.extract(input('can you?'))).rejects.toThrow(/Can't reach Ollama|too long/);
  });

  it('generates and cleans up a bullet digest', async () => {
    handler = () => ({ bullets: ['- Overdue: invoice to Northwind', '• 2 meetings today', '', 'x'.repeat(300), 'a', 'b', 'c', 'd'] });
    const bullets = await ollamaDigest({ baseUrl, model: 'qwen3:8b' }, [{ kind: 'overdue', title: 'Send invoice' }], me, RECEIVED);
    expect(bullets).toHaveLength(6);
    expect(bullets[0]).toBe('Overdue: invoice to Northwind');
    expect(bullets[1]).toBe('2 meetings today');
    expect(bullets[2].length).toBeLessThanOrEqual(160);
  });
});

describe('extraction during sync', () => {
  let repo: TaskRepository;
  beforeEach(async () => {
    const db = openNodeDb();
    await migrate(db);
    repo = new TaskRepository(db);
  });

  it('runs the sample world through the local model end to end', async () => {
    handler = fakeModel;
    const { extraction } = await runSync(repo, sampleConnectors(RECEIVED, 0), RECEIVED, {
      extractor: ollamaExtractor({ baseUrl, model: 'qwen3:8b' }),
      me,
    });
    expect(extraction).toMatchObject({ skipped: 1, fallbacks: 0 }); // the newsletter never reaches the model
    expect(requests).toHaveLength(4);
    const review = (await repo.listTasks()).filter((t) => bucketOf(t, RECEIVED) === 'review');
    expect(review.map((t) => t.extractedBy)).toEqual(['ollama', 'ollama']);
    expect(review.every((t) => t.evidence)).toBe(true);
    // the email's thread context was sent along
    expect(requests.some((r) => r.messages[1].content.includes('Legal is having a look'))).toBe(true);
  });

  it('only analyses messages it has never seen', async () => {
    let calls = 0;
    const counting: Extractor = { id: 'ollama', extract: async (i) => (calls++, extractWithRules(i)) };
    const msg = (id: string): IncomingRecord => ({ sourceId: id, kind: 'message', title: 'DM', sender: 'Priya', body: 'can you check this?' });
    const c = (ids: string[]): Connector => ({ service: 'slack', account: 'me', fetch: async () => ({ mode: 'incremental', records: ids.map(msg) }) });
    await runSync(repo, [c(['a', 'b'])], RECEIVED, { extractor: counting, me });
    await runSync(repo, [c(['b', 'c'])], RECEIVED, { extractor: counting, me }); // 'b' re-sent by the overlap window
    expect(calls).toBe(3);
    expect(await repo.listTasks()).toHaveLength(3);
  });

  it('falls back to rules once when the model is down, and says so', async () => {
    let calls = 0;
    const broken: Extractor = { id: 'ollama', extract: async () => { calls++; throw new Error("Can't reach Ollama"); } };
    const { extraction } = await runSync(repo, sampleConnectors(RECEIVED, 0), RECEIVED, { extractor: broken, me });
    expect(calls).toBe(1); // no repeated timeouts
    expect(extraction.fallbacks).toBe(4);
    expect(extraction.lastError).toBe("Can't reach Ollama");
    const review = (await repo.listTasks()).filter((t) => bucketOf(t, RECEIVED) === 'review');
    expect(review.map((t) => t.extractedBy)).toEqual(['rules', 'rules']);
  });
});

describe('deterministic daily brief', () => {
  it('builds bullets from the summary without a model', async () => {
    const { buildSummary, deterministicDigest } = await import('../src/lib/core/views');
    const db = openNodeDb();
    await migrate(db);
    const repo = new TaskRepository(db);
    await runSync(repo, sampleConnectors(RECEIVED, 0), RECEIVED, { me });
    const bullets = deterministicDigest(buildSummary(await repo.listTasks(), RECEIVED));
    expect(bullets[0]).toBe('Overdue: Send invoice to Northwind');
    expect(bullets[1]).toBe('Due today: Finalise Q4 campaign brief');
    expect(bullets.at(-1)).toBe('2 requests to review from Dana Whitfield, Priya N.');
  });
});
