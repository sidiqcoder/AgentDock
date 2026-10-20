export type Runtime = 'terminal' | 'openai' | 'webhook';
export type Status = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
export interface Connector {
  id: string;
  name: string;
  runtime: Runtime;
  command?: string;
  cwd?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  systemPrompt?: string;
  hasKey?: boolean;
  localIntegration?: 'codex' | 'opencode' | 'antigravity' | '9router';
  integrationNote?: string;
  availableModels?: string[];
  detectedAt?: string;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: string;
}
export interface Activity {
  id: string;
  at: string;
  text: string;
}
export interface SessionRun {
  id: string;
  cwd?: string;
  startedAt: string;
  endedAt: string;
  status: Status;
  output: string;
  summary: string;
  summarySource?: 'agent' | 'output';
  error: string;
}
export interface Session {
  id: string;
  cwd?: string;
  name: string;
  connectorId: string;
  connectorName: string;
  runtime: Runtime;
  status: Status;
  command?: string;
  externalSessionId?: string;
  externalAgent?: 'opencode' | 'codex';
  createdAt: string;
  updatedAt: string;
  summary: string;
  summarySource?: 'agent' | 'output';
  question: string;
  error: string;
  messages: Message[];
  activity: Activity[];
  output: string;
  alive: boolean;
  runId?: string;
  runStartedAt?: string;
  runs?: SessionRun[];
  model?: string;
  projectAccess?: boolean;
  pendingAction?: ProjectAction;
}
export interface ProjectAction {
  id: string;
  tool: 'create_directory' | 'write_file';
  path: string;
  overwrite: boolean;
  content?: string;
}
export interface Snapshot {
  connectors: Connector[];
  sessions: Session[];
  cwd: string;
}
export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  shortcuts: { name: string; path: string }[];
}
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}
export interface QuotaWindow {
  id: string;
  label: string;
  unit: 'percent' | 'requests' | 'tokens';
  remaining: number;
  limit?: number;
  resetsAt?: string;
}
export interface QuotaSnapshot {
  status: 'available' | 'unavailable' | 'stale' | 'error';
  source: string;
  checkedAt: string;
  observedAt?: string;
  note: string;
  plan?: string;
  windows: QuotaWindow[];
  accountTokens?: number;
}
export interface UsageCounter extends TokenUsage {
  requests: number;
  measuredRequests: number;
  startedAt: string;
  lastRequestAt: string;
}
export interface UsageEntry {
  connectorId: string;
  local?: UsageCounter;
  sessions: number;
  activeSessions: number;
  quota: QuotaSnapshot;
}
export interface RouterUsage extends TokenUsage {
  requests: number;
  source: string;
  note: string;
  providers: { name: string; requests: number; inputTokens: number; outputTokens: number }[];
}
export interface UsageReport {
  checkedAt: string;
  entries: UsageEntry[];
  router?: RouterUsage;
  routerNote?: string;
}
export const statusLabels: Record<Status, string> = {
  idle: 'Belum berjalan',
  running: 'Berjalan',
  waiting: 'Butuh masukan',
  completed: 'Selesai',
  failed: 'Gagal',
  stopped: 'Dihentikan',
};
export const runtimeLabels: Record<Runtime, string> = {
  terminal: 'CLI lokal',
  openai: 'Model API',
  webhook: 'n8n / Webhook',
};
export interface ExternalSession {
  id: string;
  title: string;
  directory: string;
  createdAt?: string;
  updatedAt?: string;
  agent: 'opencode' | 'codex';
}
export interface ExternalSessionDetail extends ExternalSession {
  messages: Message[];
  summary?: string;
  model?: string;
}
