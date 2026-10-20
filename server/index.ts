import express, { type ErrorRequestHandler, type Request } from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { Manager } from './manager.js';
import { Store } from './store.js';
import { connectorSchema, hookSchema } from './protocol.js';
import { discoverLocalIntegrations, listModels } from './local-integrations.js';
import { UsageService } from './usage-report.js';
import { initTray, openBrowser, type TrayController } from './tray.js';
import { listDirectories, validateDirectory } from './directories.js';
import {
  findOpenCodePath,
  listExternalSessions,
  getExternalSessionDetail,
  buildResumeCommand,
} from './external-sessions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4310);
const origin = `http://127.0.0.1:${port}`;
const defaultDataDir =
  process.env.AGENT_DOCK_DATA_DIR ||
  (root.includes('node_modules') ? path.join(homedir(), '.agent-dock') : path.join(root, '.data'));
const store = new Store(defaultDataDir);
await store.load();
const manager = new Manager(store, origin);
const usage = new UsageService(store);
const app = express();
const server = createServer(app);
const browserToken = randomBytes(32).toString('hex');
const cookieName = 'agent_dock';
const validHost = (host?: string) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
const validOrigin = (value?: string) => value === origin || value === `http://localhost:${port}`;
const hasCookie = (request: Request | import('node:http').IncomingMessage) =>
  request.headers.cookie?.split(';').some((c) => c.trim() === `${cookieName}=${browserToken}`);
app.disable('x-powered-by');
app.use((request, response, next) => {
  if (!validHost(request.headers.host)) {
    response.status(403).json({ error: 'Host tidak diizinkan. Gunakan localhost atau 127.0.0.1.' });
    return;
  }
  if (request.headers.origin && !validOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin tidak diizinkan.' });
    return;
  }
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  if (request.path.startsWith('/api')) response.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
// Hook authentication is scoped to one session and run; no browser cookie is needed.
app.post('/api/hooks/:id/:runId', (request, response) => {
  try {
    manager.hook(
      request.params.id,
      request.params.runId,
      request.headers.authorization?.replace(/^Bearer /i, '') || '',
      hookSchema.parse(request.body),
    );
    response.json({ ok: true });
  } catch {
    response.status(403).json({ error: 'Hook ditolak. Periksa token, run, dan format payload.' });
  }
});
app.get('/api/bootstrap', (_request, response) => {
  response.cookie(cookieName, browserToken, { httpOnly: true, sameSite: 'strict', path: '/' });
  response.json(manager.snapshot());
});
app.use('/api', (request, response, next) => {
  if (!hasCookie(request)) {
    response.status(401).json({ error: 'Buka ulang dashboard untuk menghubungkan sesi browser.' });
    return;
  }
  // JSON mutations cannot be made by a cross-site form. Origin validation also guards WebSockets.
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    request.method !== 'DELETE' &&
    !request.is('application/json')
  ) {
    response.status(415).json({ error: 'Gunakan Content-Type application/json.' });
    return;
  }
  next();
});
app.get('/api/health', (_request, response) =>
  response.json({ ok: !store.error, storageError: store.error }),
);
const directorySchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Direktori tidak valid.');
app.get('/api/directories', async (request, response) => {
  const directory = directorySchema.optional().parse(request.query.path);
  response.json(await listDirectories(directory));
});
app.get('/api/usage', async (request, response) => {
  response.json(await usage.report(request.query.refresh === '1'));
});
app.post('/api/integrations/local/import', async (_request, response) => {
  const discovered = await discoverLocalIntegrations(root);
  const imported = [];
  for (const connector of discovered.connectors) {
    const existing = store.state.connectors.find(
      (c) =>
        c.localIntegration === connector.localIntegration ||
        c.id === connector.id ||
        (connector.localIntegration === 'codex' && c.id === 'codex' && c.command === 'codex'),
    );
    if (existing && store.state.sessions.some((s) => s.connectorId === existing.id && s.alive)) {
      discovered.warnings.push(
        `${existing.name}: koneksi aktif dipertahankan; hentikan sesi sebelum mengimpor ulang.`,
      );
      continue;
    }
    if (existing) {
      Object.assign(existing, connector, { id: existing.id });
      imported.push(manager.publicConnector(existing));
    } else {
      store.state.connectors.push(connector);
      imported.push(manager.publicConnector(connector));
    }
  }
  await store.save();
  manager.changed();
  response.json({ connectors: imported, warnings: discovered.warnings });
});
app.get('/api/integrations/antigravity/extension', (_request, response) => {
  const inStore = path.join(store.directory, 'agent-dock-antigravity-bridge.vsix');
  const inRoot = path.join(root, '.data/agent-dock-antigravity-bridge.vsix');
  const vsixPath = existsSync(inStore) ? inStore : inRoot;
  response.download(vsixPath, 'agent-dock-antigravity-bridge.vsix', { dotfiles: 'allow' });
});
app.get('/api/integrations/antigravity/status', async (_request, response) => {
  try {
    const inStore = path.join(store.directory, 'antigravity-bridge.json');
    const inRoot = path.join(root, '.data/antigravity-bridge.json');
    const bridgePath = existsSync(inStore) ? inStore : inRoot;
    const record = JSON.parse(await readFile(bridgePath, 'utf8'));
    const url = new URL(record.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)
      throw new Error('Alamat bridge tidak valid.');
    const result = await fetch(url.origin + '/health', {
      headers: { Authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    const health = await result.json();
    response.json({
      connected: result.ok && health.nativeCommand === 'antigravity.sendPromptToAgentPanel',
      nativeCommand: health.nativeCommand,
      workspace: health.workspace,
      accepted: health.accepted,
    });
  } catch {
    response.json({ connected: false });
  }
});
app.get('/api/connectors/:id/models', async (request, response) => {
  const connector = manager.connector(request.params.id);
  const models = await listModels(connector);
  connector.availableModels = models;
  await store.save();
  manager.changed();
  response.json({ models });
});
const connectionTests = new Set<string>();
app.post('/api/connectors/:id/test', async (request, response) => {
  const { model } = z
    .object({ model: z.string().trim().min(1).max(300).optional() })
    .parse(request.body ?? {});
  if (connectionTests.has(request.params.id)) throw new Error('Uji koneksi masih berjalan.');
  connectionTests.add(request.params.id);
  try {
    response.json(await manager.testConnection(request.params.id, model));
  } finally {
    connectionTests.delete(request.params.id);
  }
});
app.post('/api/connectors', async (request, response) => {
  const connector = { id: randomUUID(), ...connectorSchema.parse(request.body) };
  store.state.connectors.push(connector);
  await store.save();
  manager.changed();
  response.status(201).json(manager.publicConnector(connector));
});
app.put('/api/connectors/:id', async (request, response) => {
  const previous = manager.connector(request.params.id);
  if (store.state.sessions.some((s) => s.connectorId === previous.id && s.alive))
    throw new Error('Hentikan sesi aktif sebelum mengubah koneksi.');
  const values = connectorSchema.parse(request.body);
  const connector = {
    ...previous,
    ...values,
    id: previous.id,
    apiKey: values.apiKey === undefined ? previous.apiKey : values.apiKey,
  };
  store.state.connectors = store.state.connectors.map((c) =>
    c.id === connector.id ? connector : c,
  );
  if (store.state.quotas) delete store.state.quotas[connector.id];
  await store.save();
  manager.changed();
  response.json(manager.publicConnector(connector));
});
app.delete('/api/connectors/:id', async (request, response) => {
  manager.connector(request.params.id);
  if (store.state.sessions.some((s) => s.connectorId === request.params.id))
    throw new Error('Hapus sesi milik koneksi ini terlebih dahulu.');
  store.state.connectors = store.state.connectors.filter((c) => c.id !== request.params.id);
  if (store.state.usage) delete store.state.usage[request.params.id];
  if (store.state.quotas) delete store.state.quotas[request.params.id];
  await store.save();
  manager.changed();
  response.json({ ok: true });
});
app.get('/api/external-sessions', async (request, response) => {
  const agent = z.enum(['opencode', 'codex']).default('opencode').parse(request.query.agent);
  const cwd = directorySchema.optional().parse(request.query.cwd);
  try {
    const sessions = await listExternalSessions(agent, { cwd });
    response.json({ sessions });
  } catch (err) {
    response.status(500).json({ error: (err as Error).message });
  }
});
app.get('/api/external-sessions/:id', async (request, response) => {
  const agent = z.enum(['opencode', 'codex']).default('opencode').parse(request.query.agent);
  try {
    const detail = await getExternalSessionDetail(agent, request.params.id);
    response.json(detail);
  } catch (err) {
    response.status(500).json({ error: (err as Error).message });
  }
});
app.post('/api/external-sessions/resume', async (request, response) => {
  const body = z
    .object({
      connectorId: z.string(),
      externalSessionId: z.string().trim().min(1),
      agent: z.enum(['opencode', 'codex']).default('opencode'),
      name: z.string().max(150).optional(),
      cwd: directorySchema.optional(),
      importHistory: z.boolean().default(true),
    })
    .parse(request.body);

  const connector = manager.connector(body.connectorId);
  if (connector.runtime !== 'terminal') {
    throw new Error('Hanya koneksi CLI terminal yang dapat melanjutkan sesi eksternal.');
  }

  let detail: import('../shared/types.js').ExternalSessionDetail | undefined;
  if (body.importHistory) {
    try {
      detail = await getExternalSessionDetail(body.agent, body.externalSessionId);
    } catch {
      /* continue without transcript if export fails */
    }
  }

  const sessionName =
    body.name?.trim() ||
    detail?.title ||
    `[${body.agent === 'opencode' ? 'OpenCode' : 'Codex'}] ${body.externalSessionId}`;
  const targetDir = body.cwd || detail?.directory || connector.cwd || process.cwd();
  const cwd = await validateDirectory(targetDir);

  const executable =
    body.agent === 'opencode'
      ? (await findOpenCodePath()) || connector.command || 'opencode'
      : connector.command || 'codex';
  const resumeCommand = buildResumeCommand(body.agent, executable, body.externalSessionId);

  const session = manager.create(body.connectorId, sessionName, undefined, cwd, false, {
    command: resumeCommand,
    externalSessionId: body.externalSessionId,
    externalAgent: body.agent,
    messages: detail?.messages,
    summary: detail?.summary,
  });

  await store.save();
  response.status(201).json({ ...session, output: '' });
});
app.post('/api/sessions', async (request, response) => {
  const body = z
    .object({
      connectorId: z.string(),
      name: z.string().max(150).default(''),
      model: z.string().trim().min(1).max(300).optional(),
      cwd: directorySchema.optional(),
      projectAccess: z.boolean().default(false),
    })
    .parse(request.body);
  const connector = manager.connector(body.connectorId);
  const cwd =
    connector.runtime === 'terminal' || (connector.runtime === 'openai' && body.projectAccess)
      ? await validateDirectory(body.cwd || connector.cwd || process.cwd())
      : undefined;
  const session = manager.create(body.connectorId, body.name, body.model, cwd, body.projectAccess);
  await store.save();
  response.status(201).json({ ...session, output: '' });
});
app.get('/api/sessions/:id/runs/:runId', (request, response) => {
  const run = manager.get(request.params.id).runs?.find((item) => item.id === request.params.runId);
  if (!run) {
    response.status(404).json({ error: 'Riwayat proses tidak ditemukan.' });
    return;
  }
  response.json(run);
});
app.post('/api/sessions/:id/start', async (request, response) => {
  const { cwd } = z.object({ cwd: directorySchema.optional() }).parse(request.body ?? {});
  await manager.start(request.params.id, cwd);
  response.json({ ok: true });
});
app.post('/api/sessions/:id/message', async (request, response) => {
  const { message } = z
    .object({ message: z.string().trim().min(1).max(50000) })
    .parse(request.body);
  await manager.send(request.params.id, message);
  response.json({ ok: true });
});
app.post('/api/sessions/:id/project', async (request, response) => {
  const { enabled, cwd } = z
    .object({ enabled: z.boolean(), cwd: directorySchema.optional() })
    .parse(request.body);
  await manager.configureProject(request.params.id, enabled, cwd);
  await store.save();
  response.json({ ok: true });
});
app.post('/api/sessions/:id/approval', (request, response) => {
  const { actionId, approved } = z
    .object({ actionId: z.string().uuid(), approved: z.boolean() })
    .parse(request.body);
  manager.approve(request.params.id, actionId, approved);
  response.json({ ok: true });
});
app.post('/api/sessions/:id/status', (request, response) => {
  const { status } = z
    .object({ status: z.enum(['running', 'waiting', 'completed']) })
    .parse(request.body);
  manager.manualStatus(request.params.id, status);
  response.json({ ok: true });
});
app.post('/api/sessions/:id/stop', (request, response) => {
  manager.stop(request.params.id);
  response.json({ ok: true });
});
app.delete('/api/sessions/:id', async (request, response) => {
  manager.removeSession(request.params.id);
  await store.save();
  response.json({ ok: true });
});
app.post('/api/demo', async (_request, response) => {
  let connector = store.state.connectors.find((c) => c.id === 'local-demo');
  if (!connector) {
    const quote = (value: string) =>
      process.platform === 'win32'
        ? `'${value.replace(/'/g, "''")}'`
        : `'${value.replace(/'/g, "'\\''")}'`;
    connector = {
      id: 'local-demo',
      name: 'Demo interaktif',
      runtime: 'terminal',
      command: `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(path.join(root, 'scripts/demo-agent.mjs'))}`,
      cwd: root,
    };
    store.state.connectors.push(connector);
  }
  const session = manager.create(connector.id, 'Coba alur agent');
  await manager.start(session.id);
  response.status(201).json({ ...session, output: '' });
});
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64_000 });
const subscriptions = new Map<WebSocket, string>();
server.on('upgrade', (request, socket, head) => {
  if (request.url?.split('?')[0] === '/ws') {
    if (
      !validHost(request.headers.host) ||
      !validOrigin(request.headers.origin) ||
      !hasCookie(request)
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else if (request.headers['sec-websocket-protocol'] !== 'vite-hmr') socket.destroy();
});
const send = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 2_000_000) {
    ws.close(1013, 'Client terlalu lambat. Sambungkan ulang.');
    return;
  }
  ws.send(JSON.stringify(payload));
};
let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
manager.on('snapshot', () => {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = undefined;
    const payload = { type: 'snapshot', data: manager.snapshot() };
    for (const ws of wss.clients) send(ws, payload);
  }, 30);
});
manager.on('output', (payload) => {
  for (const [ws, id] of subscriptions)
    if (id === payload.id) send(ws, { type: 'output', ...payload });
});
wss.on('connection', (ws) => {
  send(ws, { type: 'snapshot', data: manager.snapshot() });
  ws.on('message', (data) => {
    try {
      const message = z
        .discriminatedUnion('type', [
          z.object({ type: z.literal('subscribe'), id: z.string().nullable() }),
          z.object({ type: z.literal('input'), id: z.string(), data: z.string().max(50000) }),
          z.object({
            type: z.literal('resize'),
            id: z.string(),
            cols: z.number().int().min(10).max(500),
            rows: z.number().int().min(2).max(200),
          }),
        ])
        .parse(JSON.parse(data.toString()));
      if (message.type === 'subscribe') {
        subscriptions.delete(ws);
        if (message.id) {
          const session = manager.get(message.id);
          subscriptions.set(ws, session.id);
          send(ws, { type: 'output', id: session.id, reset: true, data: session.output });
        }
      } else if (message.type === 'input') manager.terminalInput(message.id, message.data);
      else manager.resize(message.id, message.cols, message.rows);
    } catch (error) {
      send(ws, {
        type: 'error',
        error:
          error instanceof z.ZodError ? 'Pesan terminal tidak valid.' : (error as Error).message,
      });
    }
  });
  ws.on('close', () => subscriptions.delete(ws));
  ws.on('error', () => subscriptions.delete(ws));
});

if (process.argv.includes('--production')) {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_request, response) =>
    response.sendFile(path.join(root, 'dist/index.html')),
  );
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof z.ZodError)
    response.status(400).json({ error: error.issues.map((item) => item.message).join(' ') });
  else if (error instanceof SyntaxError)
    response.status(400).json({ error: 'Payload JSON tidak valid.' });
  else {
    console.error(error.message);
    response.status(400).json({ error: error.message || 'Terjadi kesalahan.' });
  }
};
app.use(errorHandler);
server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`\n  Agent Dock sudah berjalan di background pada ${origin}.`);
    console.log('  Membuka dashboard di browser...\n');
    openBrowser(origin);
    process.exit(0);
    return;
  }
  console.error('Server gagal dijalankan:', error.message);
  process.exitCode = 1;
});

let tray: TrayController | null = null;

server.listen(port, '127.0.0.1', () => {
  console.log(`\n  Agent Dock → ${origin}\n  Runtime: lokal · Data: ${store.directory}\n`);
  if (process.argv.includes('--open')) {
    openBrowser(origin);
  }
  if (process.platform === 'win32' && !process.argv.includes('--no-tray')) {
    tray = initTray({
      port,
      origin,
      onQuit: () => {
        void shutdown();
      },
    });
    if (tray) {
      console.log('  Tray: Aktif di system tray Windows (klik ikon untuk membuka dashboard).\n');
    }
  }
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  if (tray) {
    try {
      tray.kill();
    } catch {}
    tray = null;
  }
  try {
    await manager.shutdown();
  } catch (error) {
    console.error(error);
  }
  for (const ws of wss.clients) ws.terminate();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
