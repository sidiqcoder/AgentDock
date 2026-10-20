import { z } from 'zod';
import type { TokenUsage } from '../shared/types.js';
import { readTokenUsage } from './usage.js';

const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'Gunakan URL http atau https.',
  );
export const connectorSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    runtime: z.enum(['terminal', 'openai', 'webhook']),
    command: z.string().trim().max(4000).optional(),
    cwd: z.string().trim().max(4000).optional(),
    baseUrl: httpUrl.optional(),
    model: z.string().trim().max(300).optional(),
    apiKey: z.string().max(4000).optional(),
    apiKeyEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
      .optional(),
    systemPrompt: z.string().max(20000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.runtime === 'terminal' && !value.command)
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'Perintah CLI wajib diisi.' });
    if (value.runtime !== 'terminal' && !value.baseUrl)
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'URL koneksi wajib diisi.' });
    if (value.runtime === 'openai' && !value.model)
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'ID model wajib diisi.' });
  });
export const hookSchema = z.object({
  status: z.enum(['running', 'waiting', 'completed', 'failed']),
  message: z.string().max(50000).optional(),
  question: z.string().max(10000).optional(),
  summary: z.string().max(50000).optional(),
});
export type Hook = z.infer<typeof hookSchema>;

export interface ModelToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatCompletion {
  content: string;
  toolCalls: ModelToolCall[];
  finishReason?: string;
  hasReasoning: boolean;
}
export function validateCompletion(result: ChatCompletion, allowTools = false) {
  const reason = result.finishReason;
  if (reason === 'malformed_function_call')
    throw new Error(
      'Provider mengembalikan malformed_function_call: pemanggilan tool tidak valid. Coba kirim ulang atau pilih model lain. Untuk operasi file, aktifkan Agent proyek.',
    );
  if (reason === 'length' || reason === 'max_tokens')
    throw new Error(
      'Jawaban terpotong karena mencapai batas token provider. Persempit tugas atau pilih model lain.',
    );
  if (reason === 'content_filter' || reason === 'safety')
    throw new Error('Provider menghentikan jawaban karena filter konten.');
  if (reason && !['stop', 'tool_calls', 'function_call', 'end_turn'].includes(reason))
    throw new Error(`Provider menghentikan jawaban: ${reason.slice(0, 100)}.`);
  if (result.toolCalls.length || reason === 'tool_calls' || reason === 'function_call') {
    if (!allowTools)
      throw new Error(
        'Model meminta tool. Aktifkan Agent proyek untuk operasi file, atau gunakan agent CLI / n8n.',
      );
    if (
      !result.toolCalls.length ||
      result.toolCalls.some((call) => !call.id || !call.function.name)
    )
      throw new Error('Provider mengirim pemanggilan tool yang tidak lengkap.');
    if (new Set(result.toolCalls.map((call) => call.id)).size !== result.toolCalls.length)
      throw new Error('Provider mengirim ID tool yang berulang.');
  } else if (!result.content.trim()) {
    throw new Error(
      result.hasReasoning
        ? 'Provider hanya mengirim penalaran tanpa jawaban akhir. Coba kirim ulang atau pilih model lain.'
        : 'Model tidak mengembalikan jawaban teks. Coba kirim ulang atau pilih model lain.',
    );
  }
  return result;
}

// Accepts fragmented UTF-8, CRLF, multiple events per chunk, and a final event without a blank line.
export async function consumeChatStream(
  body: ReadableStream<Uint8Array>,
  onText: (value: string) => void,
  onUsage?: (value: TokenUsage) => void,
  options: { allowTools?: boolean; signal?: AbortSignal } = {},
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let finished = false;
  const result: ChatCompletion = { content: '', toolCalls: [], hasReasoning: false };
  const calls = new Map<number, ModelToolCall>();
  const abort = () => {
    void reader.cancel(options.signal?.reason).catch(() => {});
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    if (payload === '[DONE]') {
      finished = true;
      return;
    }
    const event = JSON.parse(payload);
    if (event.error) throw new Error(event.error.message || 'Provider mengembalikan error.');
    const usage = readTokenUsage(event.usage);
    if (usage) onUsage?.(usage);
    const choice = event.choices?.[0];
    if (choice?.delta?.tool_calls?.length) {
      if (!options.allowTools)
        throw new Error(
          'Model meminta tool. Aktifkan Agent proyek untuk operasi file, atau gunakan CLI / n8n.',
        );
      for (const delta of choice.delta.tool_calls) {
        if (!Number.isInteger(delta.index) || delta.index < 0 || delta.index >= 8)
          throw new Error('Indeks tool dari provider tidak valid atau melebihi batas 8 tool.');
        const call = calls.get(delta.index) || {
          id: '',
          type: 'function' as const,
          function: { name: '', arguments: '' },
        };
        if (delta.id) call.id += delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (typeof delta.function?.arguments === 'string')
          call.function.arguments += delta.function.arguments;
        if (
          call.function.arguments.length > 256_000 ||
          call.id.length > 300 ||
          call.function.name.length > 100
        )
          throw new Error('Pemanggilan tool melebihi batas ukuran.');
        calls.set(delta.index, call);
      }
    }
    if (choice?.delta?.reasoning_content || choice?.delta?.reasoning) result.hasReasoning = true;
    if (typeof choice?.delta?.content === 'string') {
      result.content += choice.delta.content;
      if (result.content.length > 500_000)
        throw new Error('Jawaban melebihi batas 500.000 karakter.');
      onText(choice.delta.content);
    }
    if (choice?.finish_reason) {
      result.finishReason = choice.finish_reason;
      finished = true;
    }
  };
  const line = (value: string) => {
    const clean = value.replace(/\r$/, '');
    if (!clean) dispatch();
    else if (clean.startsWith('data:')) data.push(clean.slice(5).trimStart());
  };
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error('Event streaming melebihi batas ukuran.');
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
      if (done) break;
    }
    if (buffer) line(buffer);
    dispatch();
    if (!finished) throw new Error('Stream terputus sebelum model menyelesaikan jawaban.');
    result.toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    return validateCompletion(result, options.allowTools);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
