import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Connector, Session, QuotaSnapshot, UsageCounter } from '../shared/types.js';

export interface State {
  connectors: Connector[];
  sessions: Session[];
  usage?: Record<string, UsageCounter>;
  quotas?: Record<string, QuotaSnapshot>;
}
export class Store {
  state: State = { connectors: [], sessions: [] };
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  error = '';
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8'));
      if (!Array.isArray(this.state.connectors) || !Array.isArray(this.state.sessions))
        throw new Error('Format state tidak valid.');
      for (const session of this.state.sessions) {
        if (session.alive || ['running', 'waiting'].includes(session.status)) {
          session.status = 'stopped';
          session.updatedAt = new Date().toISOString();
          session.activity.push({
            id: crypto.randomUUID(),
            at: session.updatedAt,
            text: 'Server dimulai ulang. Jalankan kembali sesi untuk melanjutkan.',
          });
        }
        session.alive = false;
        delete session.pendingAction;
        if (session.runtime === 'openai') {
          session.question = '';
          session.messages = session.messages.filter(
            (message) => message.role !== 'assistant' || message.content.trim(),
          );
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state.connectors = [
        { id: 'codex', name: 'Codex', runtime: 'terminal', command: 'codex', cwd: process.cwd() },
        {
          id: 'claude',
          name: 'Claude Code',
          runtime: 'terminal',
          command: 'claude',
          cwd: process.cwd(),
        },
        {
          id: 'gemini',
          name: 'Gemini CLI',
          runtime: 'terminal',
          command: 'gemini',
          cwd: process.cwd(),
        },
      ];
    }
  }
  saveSoon() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save().catch(() => {});
    }, 300);
  }
  async save() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const data = JSON.stringify(this.state, null, 2);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const file = path.join(this.directory, 'state.json');
        await writeFile(`${file}.tmp`, data, { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        this.error = '';
      })
      .catch((error) => {
        this.error = String(error);
        console.error('Penyimpanan gagal:', error);
        throw error;
      });
    return this.queue;
  }
}
