export type Service = 'asana' | 'gdoc' | 'calendar' | 'gmail' | 'slack' | 'local';
export const SOURCE_SERVICES: Exclude<Service, 'local'>[] = ['asana', 'gdoc', 'calendar', 'gmail', 'slack'];

export const SERVICE_LABEL: Record<Service, string> = {
  asana: 'Asana',
  gdoc: 'Google Doc',
  calendar: 'Calendar',
  gmail: 'Gmail',
  slack: 'Slack',
  local: 'Personal',
};

export type RecordKind = 'task' | 'checklist_item' | 'meeting' | 'message';
export type OwnerConfidence = 'me' | 'unclear' | 'others';

/** What a connector hands to the core on every sync. Never edited by the user. */
export interface IncomingRecord {
  sourceId: string;
  kind: RecordKind;
  title: string;
  url?: string | null;
  threadId?: string | null;
  excerpt?: string | null;
  /** 'YYYY-MM-DD' or a full ISO timestamp. Only set when the source states it explicitly. */
  dueAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sender?: string | null;
  /** Nearby heading (Doc), project name (Asana), channel (Slack)... */
  context?: string | null;
  sourceTimestamp?: string | null;
  /** Messages only: present when extraction thinks this is a request for the user. */
  suggestion?: {
    action: string;
    reason: string;
    ownerConfidence: OwnerConfidence;
    /** Only an explicit date from the message. Never inferred. */
    dueAt?: string | null;
  } | null;
}

export interface SyncBatch {
  /**
   * snapshot: `records` is the complete current set for this service+account,
   *           so anything missing has been deleted or is no longer accessible.
   * incremental: only changes; deletions come through `removedSourceIds`.
   */
  mode: 'snapshot' | 'incremental';
  records: IncomingRecord[];
  removedSourceIds?: string[];
  /** Opaque cursor (history id, sync token, timestamp...) stored for the next run. */
  cursor?: string | null;
}

export interface SourceRecord {
  id: number;
  service: Service;
  account: string;
  sourceId: string;
  threadId: string | null;
  url: string | null;
  kind: RecordKind;
  title: string;
  excerpt: string | null;
  dueAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sender: string | null;
  context: string | null;
  sourceTimestamp: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  fingerprint: string;
  status: 'active' | 'unavailable';
}

export type Origin = 'source' | 'suggestion' | 'personal';
export type ReviewState = 'pending' | 'accepted' | 'rejected';

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
}

/** A task as the UI sees it: local state merged over its source record(s). */
export interface TaskView {
  id: number;
  origin: Origin;
  kind: RecordKind | 'personal';
  reviewState: ReviewState | null;
  title: string;
  sourceTitle: string | null;
  titleEdited: boolean;
  notes: string;
  excerpt: string | null;
  dueAt: string | null;
  dueEdited: boolean;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  completedAt: string | null;
  dismissedAt: string | null;
  snoozedUntil: string | null;
  sourceChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // suggestion fields
  action: string | null;
  reason: string | null;
  ownerConfidence: OwnerConfidence | null;
  sender: string | null;
  context: string | null;
  sources: { service: Service; url: string | null; status: SourceRecord['status']; sourceId: string }[];
  subtasks: Subtask[];
}

/** Fields the user can edit. `undefined` = leave unchanged. */
export interface TaskEdit {
  title?: string | null; // null = revert to source title
  notes?: string;
  dueAt?: string | null; // null = clear
  revertDue?: boolean; // drop the local due override and follow the source again
  priority?: number;
}

export interface SyncStatus {
  service: Service;
  account: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export const PRIORITY_LABEL = ['None', 'Low', 'Medium', 'High'] as const;
