import { addDays, dayKey } from '../core/dates';
import type { IncomingRecord, SyncBatch } from '../core/types';
import type { Connector } from './engine';

/**
 * Fake sources for trying the app. Messages carry no hand-made suggestion: they go through
 * the same extraction (rules or the local model) as real Gmail/Slack messages will.
 * `generation` 0 is the initial import; each
 * "Simulate refresh" bumps it and the sources change the way real ones do:
 * a renamed task, a moved deadline, a ticked Doc item, new messages.
 * Dates hang off a fixed `anchor` so the data doesn't shift at midnight.
 */
export function sampleConnectors(anchor: Date, generation: number): Connector[] {
  const d = (n: number) => dayKey(addDays(anchor, n));
  const at = (n: number, h: number, m = 0) => {
    const x = addDays(anchor, n);
    x.setHours(h, m, 0, 0);
    return x.toISOString();
  };
  const g = generation;
  const account = 'sample';

  const asana: IncomingRecord[] = [
    {
      sourceId: '1201',
      kind: 'task',
      title: g >= 1 ? 'Finalise Q4 campaign brief (v2)' : 'Finalise Q4 campaign brief',
      dueAt: d(0),
      url: 'https://app.asana.com/0/0/1201',
      excerpt: 'Pull the latest numbers from the dashboard and circulate to the team.',
      context: 'Marketing · Q4',
    },
    {
      sourceId: '1202',
      kind: 'task',
      title: 'Review homepage copy',
      dueAt: g >= 1 ? d(3) : d(1),
      url: 'https://app.asana.com/0/0/1202',
      context: 'Website refresh',
    },
    {
      sourceId: '1203',
      kind: 'task',
      title: 'Send invoice to Northwind',
      dueAt: d(-2),
      url: 'https://app.asana.com/0/0/1203',
      context: 'Admin',
    },
    {
      sourceId: '1204',
      kind: 'task',
      title: 'Prepare onboarding checklist for new hire',
      url: 'https://app.asana.com/0/0/1204',
      context: 'People',
    },
  ];

  const doc: IncomingRecord[] = [
    { sourceId: 'kix.a1', kind: 'checklist_item', title: 'Book venue for offsite', context: 'Offsite planning', url: 'https://docs.google.com/document/d/sample#heading=h.offsite' },
    { sourceId: 'kix.a2', kind: 'checklist_item', title: 'Collect dietary requirements', context: 'Offsite planning', url: 'https://docs.google.com/document/d/sample#heading=h.offsite' },
    ...(g >= 1 ? [] : [{ sourceId: 'kix.a3', kind: 'checklist_item' as const, title: 'Draft agenda', context: 'Offsite planning', url: 'https://docs.google.com/document/d/sample#heading=h.offsite' }]),
    { sourceId: 'kix.b1', kind: 'checklist_item', title: 'Update brand guidelines PDF', context: 'Design ops', url: 'https://docs.google.com/document/d/sample#heading=h.design' },
  ];

  const calendar: IncomingRecord[] = [
    { sourceId: 'evt1', kind: 'meeting', title: 'Weekly team sync', startsAt: at(0, 10), endsAt: at(0, 10, 30), url: 'https://calendar.google.com/calendar/event?eid=evt1', context: '6 attendees' },
    { sourceId: 'evt2', kind: 'meeting', title: 'Client check-in: Northwind', startsAt: at(0, 15), endsAt: at(0, 15, 45), url: 'https://calendar.google.com/calendar/event?eid=evt2', context: 'Google Meet' },
    { sourceId: 'evt3', kind: 'meeting', title: 'Design critique', startsAt: at(2, 11), endsAt: at(2, 12), url: 'https://calendar.google.com/calendar/event?eid=evt3' },
  ];

  const gmail: IncomingRecord[] = [
    {
      sourceId: 'msg-1',
      threadId: 'thr-1',
      kind: 'message',
      title: 'Re: Northwind contract',
      sender: 'Dana Whitfield',
      excerpt: 'Could you send over the signed contract by Friday? Legal needs it before the kickoff.',
      url: 'https://mail.google.com/mail/u/0/#inbox/thr-1',
      thread: [
        { sender: 'You', text: 'Hi Dana, attached is the Northwind contract for review.' },
        { sender: 'Dana Whitfield', text: 'Thanks! Legal is having a look.' },
      ],
      sourceTimestamp: at(-1, 16, 12),
    },
    {
      sourceId: 'msg-2',
      threadId: 'thr-2',
      kind: 'message',
      title: 'Team lunch Thursday',
      sender: 'Office',
      excerpt: 'Reminder: team lunch on Thursday at 12:30, see you there!',
      url: 'https://mail.google.com/mail/u/0/#inbox/thr-2',
      sourceTimestamp: at(-1, 9),
    },
    {
      sourceId: 'msg-4',
      threadId: 'thr-4',
      kind: 'message',
      title: "What's new this month",
      sender: 'Toolbox Weekly <no-reply@toolbox.example>',
      excerpt: 'Please join us for our product webinar next Tuesday! Can you guess what we shipped?',
      url: 'https://mail.google.com/mail/u/0/#inbox/thr-4',
      sourceTimestamp: at(-1, 7),
      bulk: true,
    },
    ...(g >= 1
      ? [
          {
            sourceId: 'msg-3',
            threadId: 'thr-3',
            kind: 'message' as const,
            title: 'Photos for the case study',
            sender: 'Sam Ortiz',
            excerpt: 'Someone needs to pick the final photos for the case study, maybe you or Alex? Deadline is the 15th.',
            url: 'https://mail.google.com/mail/u/0/#inbox/thr-3',
            sourceTimestamp: at(0, 8, 40),
          },
        ]
      : []),
  ];

  const slack: IncomingRecord[] = [
    {
      sourceId: 'D01:1727770000.0001',
      threadId: 'D01',
      kind: 'message',
      title: 'DM from Priya',
      sender: 'Priya N.',
      excerpt: 'hey! can you review my PR for the pricing page today? 🙏',
      url: 'https://slack.com/app_redirect?channel=D01',
      sourceTimestamp: at(0, 9, 5),
    },
    {
      sourceId: 'D02:1727770000.0002',
      threadId: 'D02',
      kind: 'message',
      title: 'DM from Leo',
      sender: 'Leo M.',
      excerpt: 'haha did you see the new coffee machine',
      url: 'https://slack.com/app_redirect?channel=D02',
      sourceTimestamp: at(0, 9, 30),
    },
  ];

  const snapshot = (records: IncomingRecord[]): SyncBatch => ({ mode: 'snapshot', records, cursor: `gen-${g}` });
  // Messages are incremental in real life too: only send what is new since the cursor.
  const incremental = (records: IncomingRecord[]) => ({
    async fetch({ cursor }: { cursor: string | null }): Promise<SyncBatch> {
      const since = cursor ? Number(cursor.replace('gen-', '')) : -1;
      const fresh = records.filter((r) => (r.sourceId === 'msg-3' ? 1 : 0) > since);
      return { mode: 'incremental', records: fresh, cursor: `gen-${g}` };
    },
  });

  return [
    { service: 'asana', account, fetch: async () => snapshot(asana) },
    { service: 'gdoc', account, fetch: async () => snapshot(doc) },
    { service: 'calendar', account, fetch: async () => snapshot(calendar) },
    { service: 'gmail', account, ...incremental(gmail) },
    { service: 'slack', account, ...incremental(slack) },
  ];
}
