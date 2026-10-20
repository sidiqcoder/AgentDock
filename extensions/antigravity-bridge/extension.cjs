const vscode = require('vscode');
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const COMMAND = 'antigravity.sendPromptToAgentPanel';
let closeBridge;
exports.activate = async function activate(context) {
  const output = vscode.window.createOutputChannel('Agent Dock');
  context.subscriptions.push(output);
  const connect = async () => {
    if (closeBridge) await closeBridge();
    const folder = vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.scheme === 'file',
    );
    if (!folder) {
      output.appendLine('Open a local workspace before connecting Agent Dock.');
      return;
    }
    const workspace = folder.uri.fsPath;
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(COMMAND)) {
      output.appendLine(
        'The native Antigravity agent panel command is unavailable in this editor.',
      );
      return;
    }
    const token = randomBytes(32).toString('hex');
    const pairingFile = path.join(workspace, '.data/antigravity-bridge.json');
    let accepted = 0;
    let port;
    const server = http.createServer(async (req, res) => {
      const reply = (status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      const provided = Buffer.from((req.headers.authorization || '').replace(/^Bearer /i, ''));
      const expected = Buffer.from(token);
      if (
        req.headers.origin ||
        req.headers.host !== `127.0.0.1:${port}` ||
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        reply(403, { error: 'Unauthorized bridge request.' });
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        reply(200, { nativeCommand: COMMAND, workspace, accepted });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/prompt') {
        reply(404, { error: 'Not found.' });
        return;
      }
      try {
        if (!vscode.workspace.isTrusted)
          throw new Error('Workspace trust requires confirmation in the IDE.');
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 128000) throw new Error('Prompt too large.');
        }
        const body = JSON.parse(raw);
        if (typeof body.prompt !== 'string' || !body.prompt.trim())
          throw new Error('Prompt is required.');
        if (
          body.workspace &&
          path.resolve(body.workspace).toLowerCase() !== path.resolve(workspace).toLowerCase()
        )
          throw new Error('The IDE workspace does not match the Agent Dock session.');
        await vscode.commands.executeCommand(COMMAND, body.prompt);
        accepted++;
        output.appendLine(`Native agent panel accepted request ${accepted}.`);
        reply(200, { accepted: true, nativeCommand: COMMAND, acceptedCount: accepted });
      } catch (error) {
        output.appendLine(error.message);
        reply(400, { error: error.message });
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
    await fs.mkdir(path.dirname(pairingFile), { recursive: true });
    await fs.writeFile(
      pairingFile,
      JSON.stringify({ url: `http://127.0.0.1:${port}`, token, workspace, nativeCommand: COMMAND }),
      { mode: 0o600 },
    );
    closeBridge = async () => {
      server.closeAllConnections();
      server.close();
      try {
        const current = JSON.parse(await fs.readFile(pairingFile, 'utf8'));
        if (current.token === token) await fs.rm(pairingFile, { force: true });
      } catch {
        /* Already removed. */
      }
    };
    output.appendLine('Agent Dock connected to native Antigravity panel for this workspace.');
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    status.text = '$(plug) Agent Dock';
    status.tooltip = 'Native Antigravity panel connected locally';
    status.command = 'agentDock.connect';
    status.show();
    context.subscriptions.push(status);
  };
  context.subscriptions.push(vscode.commands.registerCommand('agentDock.connect', connect));
  context.subscriptions.push({
    dispose() {
      if (closeBridge) void closeBridge();
    },
  });
  await connect();
};
exports.deactivate = async () => {
  if (closeBridge) await closeBridge();
};
