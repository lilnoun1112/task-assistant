import type { Service, Suggestion } from '../core/types';

export interface Me {
  /** How people address the user, e.g. "Marcell". */
  name: string;
  /** Other handles / spellings: "marci", "@marcell", "mj". */
  aliases: string[];
}

/** Everything an extractor may look at for one message. Built fresh per sync; never stored. */
export interface ExtractInput {
  service: Service;
  sender: string;
  subject: string;
  text: string;
  receivedAt: string;
  /** Earlier messages in the thread, oldest first. */
  thread: { sender: string; text: string }[];
  me: Me;
}

export interface Extractor {
  id: 'rules' | 'ollama';
  /** null = not a request for the user. Throws when the engine itself fails (e.g. Ollama not running). */
  extract(input: ExtractInput): Promise<Suggestion | null>;
}
