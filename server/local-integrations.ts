import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Connector } from '../shared/types.js';

export const quoteShell = (value: string, platform = process.platform) =>
  platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;

async function firstFile(paths: string[]) {
  for (const file of paths) {
    try {
      await access(file);
      return file;
    } catch {
      /* Try the next installation. */
    }
  }
}
export async function findExecutable(name: string, candidates: string[] = []) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const directories = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  return firstFile([
    ...candidates,
    ...directories.flatMap((dir) => extensions.map((ext) => path.join(dir, name + ext))),
  ]);
}
async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}
const isLoopback = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};
export function findLocalRouter(config: any) {
  return Object.entries(config.provider || {}).find(([, value]) => {
    const candidate = value as any;
    return (
      typeof candidate.options?.baseURL === 'string' &&
      isLoopback(candidate.options.baseURL) &&
      new URL(candidate.options.baseURL).port === '20128'
    );
  });
}
export async function listModels(connector: Connector) {
  if (connector.runtime !== 'openai' || !connector.baseUrl)
    throw new Error('Daftar model hanya tersedia untuk koneksi Model API.');
  const key = connector.apiKey || (connector.apiKeyEnv ? process.env[connector.apiKeyEnv] : '');
  const response = await fetch(connector.baseUrl.replace(/\/+$/, '') + '/models', {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Daftar model gagal: HTTP ${response.status}.`);
  const json = await response.json();
  const models = [
    ...new Set<string>(
      (Array.isArray(json.data) ? json.data : []).flatMap((item: any) =>
        typeof item.id === 'string' ? [item.id] : [],
      ),
    ),
  ];
  if (!models.length) throw new Error('Endpoint tidak mengembalikan daftar model.');
  return models;
}

export async function discoverLocalIntegrations(root: string, home = homedir()) {
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
  const programFiles = process.env.ProgramFiles || 'C:/Program Files';
  const [codex, opencode, antigravity, config, recent] = await Promise.all([
    findExecutable('codex', [path.join(local, 'Programs/OpenAI/Codex/bin/codex.exe')]),
    findExecutable('opencode', [
      path.join(programFiles, 'nodejs/node_modules/opencode-ai/bin/opencode.exe'),
    ]),
    firstFile([path.join(local, 'Programs/Antigravity IDE/bin/antigravity-ide.cmd')])
      .then((found) => found || findExecutable('antigravity-ide'))
      .then((found) => found || findExecutable('antigravity')),
    readJson(path.join(home, '.config/opencode/opencode.json')),
    readJson(path.join(home, '.local/state/opencode/model.json')),
  ]);
  const connectors: Connector[] = [];
  const warnings: string[] = [];
  const prefix = process.platform === 'win32' ? '& ' : '';
  const detectedAt = new Date().toISOString();
  if (codex)
    connectors.push({
      id: 'local-codex',
      name: 'Codex · lokal',
      runtime: 'terminal',
      command: `${prefix}${quoteShell(codex)} --no-alt-screen --no-daemon`,
      cwd: root,
      localIntegration: 'codex',
      detectedAt,
      integrationNote:
        'Memakai login dan konfigurasi Codex lokal. Persetujuan tetap mengikuti izin CLI.',
    });
  else warnings.push('Codex CLI belum ditemukan.');
  if (opencode)
    connectors.push({
      id: 'local-opencode',
      name: 'OpenCode · lokal',
      runtime: 'terminal',
      command: `${prefix}${quoteShell(opencode)}`,
      cwd: root,
      localIntegration: 'opencode',
      detectedAt,
      integrationNote:
        'Memakai provider, model, plugin, dan login OpenCode yang sudah dikonfigurasi lokal.',
    });
  else warnings.push('OpenCode belum ditemukan.');
  if (antigravity)
    connectors.push({
      id: 'local-antigravity',
      name: 'Antigravity IDE · lokal',
      runtime: 'terminal',
      command: `${prefix}${quoteShell(process.execPath)} ${quoteShell(path.join(root, 'scripts/antigravity-agent.mjs'))}`,
      cwd: root,
      localIntegration: 'antigravity',
      detectedAt,
      integrationNote:
        'Memerlukan ekstensi Agent Dock Bridge di Antigravity IDE. Prompt diterima hanya setelah panel native mengonfirmasi; status dan ringkasan melalui hook.',
    });
  else warnings.push('Antigravity IDE belum ditemukan.');
  // Only reuse credentials belonging to a loopback router. Never import unrelated cloud keys.
  const provider = findLocalRouter(config);
  const options = (provider?.[1] as any)?.options || {};
  const rawKey = typeof options.apiKey === 'string' ? options.apiKey : '';
  const envMatch = rawKey.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
  const connector: Connector = {
    id: 'local-9router',
    name: '9router · lokal',
    runtime: 'openai',
    baseUrl: options.baseURL || 'http://127.0.0.1:20128/v1',
    ...(envMatch
      ? { apiKeyEnv: envMatch[1] }
      : rawKey && !rawKey.startsWith('{')
        ? { apiKey: rawKey }
        : {}),
    localIntegration: '9router',
    detectedAt,
  };
  try {
    connector.availableModels = await listModels(connector);
    const configured = (recent.recent || [])
      .filter((item: any) => item.providerID === provider?.[0])
      .map((item: any) => item.modelID);
    const configuredDefault =
      typeof config.model === 'string' && provider && config.model.startsWith(provider[0] + '/')
        ? config.model.slice(provider[0].length + 1)
        : undefined;
    connector.model =
      [configuredDefault, ...configured, ...Object.keys((provider?.[1] as any)?.models || {})].find(
        (model: string | undefined) => model && connector.availableModels!.includes(model),
      ) || connector.availableModels[0];
    connector.integrationNote = `${connector.availableModels.length} model terdeteksi. Model awal mengikuti konfigurasi / riwayat router lokal jika tersedia. Kredensial router digunakan hanya di server Agent Dock.`;
    connectors.push(connector);
  } catch (error) {
    warnings.push(`9router: ${(error as Error).message}`);
  }
  return { connectors, warnings };
}
