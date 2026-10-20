import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectTools } from '../server/project-tools.js';

async function fixture() {
  const base = path.resolve('.cache/test-data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'project-tools-'));
  const root = path.join(directory, 'project');
  await mkdir(root);
  return {
    directory,
    root,
    tools: await ProjectTools.create(root),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
const signal = () => new AbortController().signal;

test('project tools create/read/write only after approval and detect intervening edits', async () => {
  const f = await fixture();
  try {
    let approvals = 0;
    const execute = (name: string, args: unknown, approved = true) =>
      f.tools.execute(
        name,
        JSON.stringify(args),
        async () => {
          approvals++;
          return approved;
        },
        signal(),
      );
    await execute('create_directory', { path: 'docs' }, false);
    await assert.rejects(readFile(path.join(f.root, 'docs')), { code: 'ENOENT' });
    await execute('create_directory', { path: 'docs' });
    await execute('write_file', { path: 'docs/a.md', content: 'original text' });
    assert.equal(
      JSON.parse(await execute('read_file', { path: 'docs/a.md' })).content,
      'original text',
    );
    assert.equal(approvals, 3);
    await execute('write_file', { path: 'docs/a.md', content: 'new' });
    assert.equal(await readFile(path.join(f.root, 'docs/a.md'), 'utf8'), 'new');
    await assert.rejects(
      f.tools.execute(
        'write_file',
        JSON.stringify({ path: 'docs/a.md', content: 'stale' }),
        async () => {
          await writeFile(path.join(f.root, 'docs/a.md'), 'changed by user');
          return true;
        },
        signal(),
      ),
      /berubah/,
    );
    assert.equal(await readFile(path.join(f.root, 'docs/a.md'), 'utf8'), 'changed by user');
    const listing = JSON.parse(await execute('list_directory', { path: '.' }));
    assert.deepEqual(listing.entries, [{ name: 'docs', type: 'directory' }]);
  } finally {
    await f.cleanup();
  }
});

test('project tools reject traversal, symlink escape, unsupported tools and cancelled approvals', async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.directory, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'private.txt'), 'must not read');
    await symlink(
      outside,
      path.join(f.root, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const approve = async () => {
      throw new Error('Must reject before approval');
    };
    for (const target of [
      '../outside/private.txt',
      path.join(outside, 'private.txt'),
      'link/private.txt',
    ]) {
      await assert.rejects(
        f.tools.execute('read_file', JSON.stringify({ path: target }), approve, signal()),
        /luar/,
      );
    }
    await assert.rejects(
      f.tools.execute(
        'write_file',
        JSON.stringify({ path: 'link/new.txt', content: 'no' }),
        approve,
        signal(),
      ),
      /luar/,
    );
    await assert.rejects(
      f.tools.execute('run_shell', '{"path":"."}', approve, signal()),
      /tidak tersedia/,
    );
    await link(path.join(outside, 'private.txt'), path.join(f.root, 'hardlink.txt'));
    await assert.rejects(
      f.tools.execute('write_file', '{"path":"hardlink.txt","content":"no"}', approve, signal()),
      /hard link/,
    );
    assert.equal(await readFile(path.join(outside, 'private.txt'), 'utf8'), 'must not read');
    const controller = new AbortController();
    await assert.rejects(
      f.tools.execute(
        'write_file',
        '{"path":"cancel.txt","content":"no"}',
        async () => {
          controller.abort();
          return true;
        },
        controller.signal,
      ),
      { name: 'AbortError' },
    );
    await assert.rejects(readFile(path.join(f.root, 'cancel.txt')), { code: 'ENOENT' });
    await assert.rejects(
      f.tools.execute(
        'write_file',
        '{"path":"race.txt","content":"no"}',
        async () => {
          await symlink(
            outside,
            path.join(f.root, 'race.txt'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          return true;
        },
        signal(),
      ),
      /luar|berubah/,
    );
  } finally {
    await f.cleanup();
  }
});
