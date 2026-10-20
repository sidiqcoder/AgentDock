import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DirectoryListing } from '../shared/types.js';

export async function validateDirectory(value: string): Promise<string> {
  const directory = path.resolve(value);
  try {
    if ((await stat(directory)).isDirectory()) return directory;
  } catch {
    throw new Error(`Direktori tidak ditemukan atau tidak dapat diakses: ${directory}`);
  }
  throw new Error(`Path bukan direktori: ${directory}`);
}

export async function listDirectories(value = process.cwd()): Promise<DirectoryListing> {
  const directory = await validateDirectory(value);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error(`Isi direktori tidak dapat dibaca: ${directory}`);
  }
  const children = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) return { name: entry.name, path: child };
      if (entry.isSymbolicLink()) {
        try {
          if ((await stat(child)).isDirectory()) return { name: entry.name, path: child };
        } catch {
          // Broken or inaccessible links cannot be opened as directories.
        }
      }
      return null;
    }),
  );
  const shortcuts = [
    { name: 'Folder pengguna', path: homedir() },
    { name: 'Folder aplikasi', path: process.cwd() },
  ];
  if (process.platform === 'win32') {
    const drives = await Promise.all(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
        const drive = `${letter}:\\`;
        try {
          return (await stat(drive)).isDirectory() ? { name: drive, path: drive } : null;
        } catch {
          return null;
        }
      }),
    );
    shortcuts.push(...drives.filter((drive) => drive !== null));
  } else {
    shortcuts.push({ name: 'Root /', path: '/' });
  }
  const parent = path.dirname(directory);
  return {
    path: directory,
    parent: parent === directory ? null : parent,
    directories: children
      .filter((child) => child !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    shortcuts,
  };
}
