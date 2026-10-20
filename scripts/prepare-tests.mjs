import ts from 'typescript';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const directory of ['server', 'shared', 'tests', 'src']) {
  await mkdir(path.join('.cache/tests', directory), { recursive: true });
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.ts')) continue;
    const source = await readFile(path.join(directory, name), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
      },
    });
    await writeFile(path.join('.cache/tests', directory, name.replace(/\.ts$/, '.js')), outputText);
  }
}
await writeFile(
  '.cache/tests/tests/runner.mjs',
  "import './api.test.js';\nimport './manager.test.js';\nimport './directories.test.js';\nimport './protocol.test.js';\nimport './project-tools.test.js';\nimport './local-integrations.test.js';\nimport './ide-handoff.test.js';\nimport './ide-bridge.test.js';\nimport './usage.test.js';\nimport './autostart.test.js';\nimport './external-sessions.test.js';\n",
);
