import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listDirectories, validateDirectory } from '../server/directories.js';

test('folder browser lists only directories, sorts naturally and supports parents and roots', async () => {
  const base = path.resolve('.cache/test-data');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'folders-'));
  try {
    const names = ['proyek 10', 'proyek 2', 'proyek & satu'];
    await Promise.all(names.map((name) => mkdir(path.join(directory, name))));
    const file = path.join(directory, 'file.txt');
    await writeFile(file, 'fixture');
    const listing = await listDirectories(directory);
    assert.equal(listing.path, directory);
    assert.equal(listing.parent, path.dirname(directory));
    assert.deepEqual(
      listing.directories.map((child) => child.name),
      ['proyek & satu', 'proyek 2', 'proyek 10'],
    );
    assert.ok(
      listing.directories.every((child) => child.path === path.join(directory, child.name)),
    );
    assert.ok(listing.shortcuts.some((shortcut) => shortcut.path === process.cwd()));
    const empty = await listDirectories(path.join(directory, names[0]));
    assert.deepEqual(empty.directories, []);
    assert.equal((await listDirectories(path.parse(directory).root)).parent, null);
    assert.equal(await validateDirectory(path.relative(process.cwd(), directory)), directory);
    await assert.rejects(listDirectories(file), /bukan direktori/);
    await assert.rejects(listDirectories(path.join(directory, 'missing')), /tidak ditemukan/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
