import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorSchema, consumeChatStream } from '../server/protocol.js';

function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}
test('SSE handles fragmented UTF-8, CRLF, usage chunks and a final event without newline', async () => {
  const text =
    ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"Halo 🌱"}}]}\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":12}}\r\n\r\ndata: [DONE]';
  const bytes = new TextEncoder().encode(text);
  let output = '';
  await consumeChatStream(stream([...bytes].map((byte) => Uint8Array.of(byte))), (value) => {
    output += value;
  });
  assert.equal(output, 'Halo 🌱');
});
test('SSE rejects an interrupted stream instead of marking the task completed', async () => {
  const text = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  await assert.rejects(
    consumeChatStream(stream([new TextEncoder().encode(text)]), () => {}),
    /terputus/,
  );
});
test('SSE rejects provider errors and unsupported tool requests', async () => {
  for (const payload of [
    { error: { message: 'quota' } },
    { choices: [{ delta: { tool_calls: [{ id: 'a' }] } }] },
  ]) {
    await assert.rejects(
      consumeChatStream(
        stream([new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)]),
        () => {},
      ),
      /quota|tool/i,
    );
  }
});

test('model streams preserve provider failure reasons and reject reasoning without a final answer', async () => {
  for (const [reason, expected] of [
    ['malformed_function_call', /malformed_function_call/],
    ['length', /batas/],
    ['content_filter', /filter/],
  ] as const) {
    await assert.rejects(
      consumeChatStream(
        stream([
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
          ),
        ]),
        () => {},
      ),
      expected,
    );
  }
  let visible = '';
  await assert.rejects(
    consumeChatStream(
      stream([
        new TextEncoder().encode(
          'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ),
      ]),
      (value) => {
        visible += value;
      },
    ),
    /jawaban akhir/,
  );
  assert.equal(visible, '');
});

test('agent streams assemble fragmented tool calls without exposing reasoning', async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: 'private' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                type: 'function',
                function: { name: 'create_directory', arguments: '{"pa' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"docs"}' } }] } }],
    },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  let visible = '';
  const result = await consumeChatStream(
    stream([
      new TextEncoder().encode(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      ),
    ]),
    (value) => {
      visible += value;
    },
    undefined,
    { allowTools: true },
  );
  assert.equal(visible, '');
  assert.deepEqual(result.toolCalls, [
    {
      id: 'call-1',
      type: 'function',
      function: { name: 'create_directory', arguments: '{"path":"docs"}' },
    },
  ]);
});
test('aborting a pending stream cancels its reader immediately', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new TextEncoder().encode(': waiting\n\n'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const pending = consumeChatStream(body, () => {}, undefined, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('connector validation requires runtime fields and rejects non-HTTP URLs', () => {
  assert.equal(connectorSchema.safeParse({ name: 'CLI', runtime: 'terminal' }).success, false);
  assert.equal(
    connectorSchema.safeParse({
      name: 'model',
      runtime: 'openai',
      baseUrl: 'http://localhost:20128/v1',
    }).success,
    false,
  );
  assert.equal(
    connectorSchema.safeParse({ name: 'hook', runtime: 'webhook', baseUrl: 'file:///private' })
      .success,
    false,
  );
  assert.equal(
    connectorSchema.safeParse({
      name: 'model',
      runtime: 'openai',
      baseUrl: 'http://localhost:20128/v1',
      model: 'my-model',
    }).success,
    true,
  );
});
