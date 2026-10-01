import { dayKey, dueInstant, startOfDay } from './dates';
import type { Service, TaskView } from './types';

export type Bucket = 'today' | 'upcoming' | 'review' | 'completed' | 'dismissed' | 'snoozed';

/** Meetings are dated by their start; everything else by its (possibly edited) due date. */
export function effectiveDate(t: TaskView): string | null {
  return t.kind === 'meeting' ? t.startsAt : t.dueAt;
}

export function isOverdue(t: TaskView, now: Date): boolean {
  if (t.kind === 'meeting' || !t.dueAt || t.completedAt) return false;
  return dayKey(t.dueAt) < dayKey(now) || (!/^\d{4}-\d{2}-\d{2}$/.test(t.dueAt) && dueInstant(t.dueAt) < now.getTime());
}

/** Which tab a task belongs in, or null when it should not be shown at all. */
export function bucketOf(t: TaskView, now: Date): Bucket | null {
  if (t.reviewState === 'rejected') return 'dismissed';
  if (t.dismissedAt) return 'dismissed';
  if (t.completedAt) return 'completed';
  if (t.snoozedUntil && new Date(t.snoozedUntil) > now) return 'snoozed';
  if (t.reviewState === 'pending') return 'review';

  const date = effectiveDate(t);
  if (t.kind === 'meeting') {
    if (!date) return 'upcoming';
    const end = t.endsAt ?? date;
    if (dayKey(end) < dayKey(now)) return null; // past meetings just drop off
    return dayKey(date) <= dayKey(now) ? 'today' : 'upcoming';
  }
  if (date && dayKey(date) <= dayKey(now)) return 'today';
  return 'upcoming';
}

export type SortMode = 'due' | 'priority';

export interface Filter {
  search: string;
  services: Set<Service>; // empty = all
}

export function matches(t: TaskView, f: Filter): boolean {
  if (f.services.size) {
    const svc: Service[] = t.sources.length ? t.sources.map((s) => s.service) : ['local'];
    if (!svc.some((s) => f.services.has(s))) return false;
  }
  const q = f.search.trim().toLowerCase();
  if (!q) return true;
  return [t.title, t.notes, t.excerpt, t.sender, t.context, t.reason, ...t.subtasks.map((s) => s.title)]
    .filter(Boolean)
    .some((s) => s!.toLowerCase().includes(q));
}

function byDue(a: TaskView, b: TaskView): number {
  const da = effectiveDate(a);
  const db = effectiveDate(b);
  if (da && db) return dueInstant(da) - dueInstant(db);
  if (da) return -1;
  if (db) return 1;
  return 0;
}

export function sortTasks(tasks: TaskView[], mode: SortMode): TaskView[] {
  return [...tasks].sort((a, b) => {
    const primary = mode === 'priority' ? b.priority - a.priority || byDue(a, b) : byDue(a, b) || b.priority - a.priority;
    return primary || a.id - b.id;
  });
}

export function sortCompleted(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((a, b) => (b.completedAt ?? b.dismissedAt ?? '').localeCompare(a.completedAt ?? a.dismissedAt ?? ''));
}

export interface Summary {
  overdue: TaskView[];
  dueToday: TaskView[];
  meetings: TaskView[];
  unreviewed: TaskView[];
  text: string;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Deterministic daily summary built from stored data only (no language model).
 * Meetings covers today and tomorrow so the evening view is still useful.
 */
export function buildSummary(tasks: TaskView[], now: Date): Summary {
  const today = dayKey(now);
  const tomorrowEnd = startOfDay(now, 2).getTime();
  const open = tasks.filter((t) => {
    const b = bucketOf(t, now);
    return b === 'today' || b === 'upcoming';
  });
  const overdue = open.filter((t) => isOverdue(t, now));
  const dueToday = open.filter((t) => t.kind !== 'meeting' && t.dueAt && dayKey(t.dueAt) === today && !isOverdue(t, now));
  const meetings = sortTasks(
    open.filter(
      (t) =>
        t.kind === 'meeting' &&
        t.startsAt &&
        new Date(t.endsAt ?? t.startsAt).getTime() >= now.getTime() &&
        new Date(t.startsAt).getTime() < tomorrowEnd,
    ),
    'due',
  );
  const unreviewed = tasks.filter((t) => bucketOf(t, now) === 'review');

  const parts: string[] = [];
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (dueToday.length) parts.push(`${dueToday.length} due today`);
  if (meetings.length) parts.push(`${plural(meetings.length, 'meeting')} coming up`);
  if (unreviewed.length) parts.push(`${plural(unreviewed.length, 'request')} to review`);
  const text = parts.length ? parts.join(' · ') : 'Nothing pressing. Nice.';
  return { overdue, dueToday, meetings, unreviewed, text };
}
