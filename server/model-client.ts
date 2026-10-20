import { z } from 'zod';
import type { TokenUsage } from '../shared/types.js';
import { consumeChatStream, validateCompletion, type ModelToolCall } from './protocol.js';
import { readTokenUsage } from './usage.js';

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
}
export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export async function requestCompletion(options: {
  baseUrl: string;
  key?: string;
  model: string;
  messages: ModelMessage[];
  tools?: ModelTool[];
  signal: AbortSignal;
  onText?: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onHeaders?: (headers: Headers) => void;
}) {
  const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.tools ? { tools: options.tools, tool_choice: 'auto' } : {}),
    }),
    signal: options.signal,
    redirect: 'error',
  });
  options.onHeaders?.(response.headers);
  if (!response.ok) {
    let detail = '';
    try {
      const json = await response.json();
      if (typeof json.error?.message === 'string') {
        const safe = options.key
          ? json.error.message.split(options.key).join('[redacted]')
          : json.error.message;
        detail = safe.slice(0, 500);
      }
    } catch {
      /* HTML error pages do not belong in the dashboard. */
    }
    throw new Error(
      `Endpoint mengembalikan HTTP ${response.status}. ${detail || 'Periksa URL, model, kredensial, dan kuota provider.'}`,
    );
  }
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    if (!response.body) throw new Error('Stream kosong.');
    return consumeChatStream(response.body, options.onText || (() => {}), options.onUsage, {
      allowTools: !!options.tools,
      signal: options.signal,
    });
  }
  const json = await response.json();
  const usage = readTokenUsage(json.usage);
  if (usage) options.onUsage?.(usage);
  if (json.error) throw new Error(json.error.message || 'Provider gagal memberikan jawaban.');
  const choice = json.choices?.[0];
  const message = choice?.message;
  const calls = z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        type: z.literal('function'),
        function: z.object({
          name: z.string().min(1).max(100),
          arguments: z.string().max(256_000),
        }),
      }),
    )
    .max(8)
    .parse(message?.tool_calls || []);
  const result = validateCompletion(
    {
      content: typeof message?.content === 'string' ? message.content : '',
      toolCalls: calls,
      hasReasoning: !!(message?.reasoning_content || message?.reasoning),
      finishReason: choice?.finish_reason,
    },
    !!options.tools,
  );
  if (result.content.length > 500_000) throw new Error('Jawaban melebihi batas 500.000 karakter.');
  options.onText?.(result.content);
  return result;
}
