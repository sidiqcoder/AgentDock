import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ProjectAction } from '../shared/types.js';
import type { ModelTool } from './model-client.js';

const MAX_FILE = 128_000;
const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'));
const argsSchema = z.object({ path: pathSchema });
const writeSchema = argsSchema.extend({ content: z.string().max(MAX_FILE) });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const projectTools: ModelTool[] = [
  ['list_directory', 'List files and subdirectories inside the selected project.'],
  ['read_file', 'Read a UTF-8 text file inside the selected project (maximum 128 KB).'],
  ['create_directory', 'Create a directory inside the selected project after user approval.'],
  [
    'write_file',
    'Create or replace a UTF-8 file after user approval. Read existing files before changing them. Parent directory must exist.',
  ],
].map(([name, description]) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to the project root, or an absolute path inside it.',
        },
        ...(name === 'write_file'
          ? { content: { type: 'string', description: 'Complete new file contents.' } }
          : {}),
      },
      required: name === 'write_file' ? ['path', 'content'] : ['path'],
      additionalProperties: false,
    },
  },
}));

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export class ProjectTools {
  private constructor(readonly root: string) {}
  static async create(directory: string) {
    return new ProjectTools(await realpath(directory));
  }

  private async target(value: string): Promise<string> {
    const target = path.resolve(this.root, value);
    if (!inside(this.root, target))
      throw new Error('Path berada di luar direktori proyek yang dipilih.');
    let ancestor = target;
    const missing: string[] = [];
    while (true) {
      try {
        const canonical = await realpath(ancestor);
        if (!inside(this.root, canonical))
          throw new Error('Symlink mengarah ke luar direktori proyek.');
        return path.join(canonical, ...missing.reverse());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const info = await lstat(ancestor).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
          return undefined;
        });
        if (info?.isSymbolicLink()) throw new Error('Symlink rusak tidak dapat digunakan.');
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error('Direktori proyek tidak tersedia.');
        missing.push(path.basename(ancestor));
        ancestor = parent;
      }
    }
  }
  private async read(file: string) {
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE)
        throw new Error('Tool hanya dapat membaca file teks hingga 128 KB.');
      const buffer = Buffer.alloc(MAX_FILE + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!part.bytesRead) break;
        bytesRead += part.bytesRead;
      }
      if (bytesRead > MAX_FILE || buffer.subarray(0, bytesRead).includes(0))
        throw new Error('File terlalu besar atau bukan teks UTF-8.');
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async execute(
    name: string,
    raw: string,
    approve: (action: ProjectAction) => Promise<boolean>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (!projectTools.some((tool) => tool.function.name === name))
      throw new Error(`Tool tidak tersedia: ${name}`);
    const parsed: unknown = JSON.parse(raw);
    const args = argsSchema.parse(parsed);
    const target = await this.target(args.path);
    if (name === 'list_directory') {
      const entries = await readdir(target, { withFileTypes: true });
      return JSON.stringify({
        path: target,
        entries: entries.slice(0, 500).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
        })),
        truncated: entries.length > 500,
      });
    }
    if (name === 'read_file')
      return JSON.stringify({ path: target, content: await this.read(target) });
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (name === 'create_directory' && info?.isDirectory())
      return JSON.stringify({ path: target, exists: true });
    if (info && !info.isFile()) throw new Error('Target perubahan bukan file biasa.');
    if (info && info.nlink > 1) throw new Error('File dengan hard link tidak dapat ditimpa.');
    const content = name === 'write_file' ? writeSchema.parse(parsed).content : undefined;
    if (content !== undefined && Buffer.byteLength(content) > MAX_FILE)
      throw new Error('Isi file melebihi 128 KB.');
    const previous = info ? hash(await this.read(target)) : undefined;
    const action: ProjectAction = {
      id: randomUUID(),
      tool: name as ProjectAction['tool'],
      path: target,
      overwrite: !!info,
      ...(content !== undefined ? { content } : {}),
    };
    if (!(await approve(action)))
      return JSON.stringify({
        denied: true,
        message: 'Pengguna menolak perubahan ini. Jangan mengulangi permintaan yang sama.',
      });
    signal.throwIfAborted();
    // Resolve the original path again after approval; a symlink may have changed while waiting.
    if ((await this.target(args.path)) !== target)
      throw new Error('Path berubah selama menunggu persetujuan. Perubahan dibatalkan.');
    const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (
      current?.isSymbolicLink() ||
      !!current !== !!info ||
      (current &&
        (!current.isFile() || current.nlink > 1 || hash(await this.read(target)) !== previous))
    )
      throw new Error(
        'Target berubah selama menunggu persetujuan. Baca ulang sebelum mengubahnya.',
      );
    if (name === 'create_directory') await mkdir(target, { recursive: true });
    else {
      const file = await open(target, info ? 'r+' : 'wx');
      try {
        const opened = await file.stat();
        if (opened.nlink > 1 || (info && (opened.ino !== info.ino || opened.dev !== info.dev)))
          throw new Error('File berubah sebelum penulisan. Perubahan dibatalkan.');
        signal.throwIfAborted();
        await file.writeFile(content!, 'utf8');
        await file.truncate(Buffer.byteLength(content!));
      } finally {
        await file.close();
      }
    }
    return JSON.stringify({ path: target, success: true });
  }
}
