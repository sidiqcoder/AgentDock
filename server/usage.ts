import type { QuotaSnapshot, QuotaWindow, TokenUsage } from '../shared/types.js';
export { ageQuota } from '../shared/usage.js';

export function nonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function readTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const raw = value as Record<string, any>;
  const inputTokens = nonnegative(raw.prompt_tokens ?? raw.input_tokens);
  const outputTokens = nonnegative(raw.completion_tokens ?? raw.output_tokens);
  const totalTokens =
    nonnegative(raw.total_tokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const cachedTokens = nonnegative(
    raw.prompt_tokens_details?.cached_tokens ?? raw.input_tokens_details?.cached_tokens,
  );
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return;
  return { inputTokens, outputTokens, totalTokens, cachedTokens };
}

function resetTime(value: string | null, now: number): string | undefined {
  if (!value) return;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    const timestamp = number > 1e12 ? number : number > 1e9 ? number * 1000 : now + number * 1000;
    if (Number.isFinite(timestamp) && timestamp < 8.64e15) return new Date(timestamp).toISOString();
    return;
  }
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (parts.length && parts.map((p) => p[0]).join('') === value) {
    const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const timestamp = now + parts.reduce((sum, p) => sum + Number(p[1]) * units[p[2]], 0);
    if (Number.isFinite(timestamp) && timestamp < 8.64e15) return new Date(timestamp).toISOString();
    return;
  }
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
}

export function readRateLimitHeaders(
  headers: Headers,
  model: string,
  now = Date.now(),
): QuotaSnapshot | undefined {
  const windows: QuotaWindow[] = [];
  for (const [key, label, unit] of [
    ['requests', 'Permintaan', 'requests'],
    ['tokens', 'Token', 'tokens'],
    ['project-tokens', 'Token proyek', 'tokens'],
  ] as const) {
    const rawRemaining = headers.get(`x-ratelimit-remaining-${key}`);
    const rawLimit = headers.get(`x-ratelimit-limit-${key}`);
    const remaining = rawRemaining?.trim() ? nonnegative(Number(rawRemaining)) : undefined;
    const limit = rawLimit?.trim() ? nonnegative(Number(rawLimit)) : undefined;
    if (remaining === undefined) continue;
    windows.push({
      id: key,
      label,
      unit,
      remaining,
      limit,
      resetsAt: resetTime(headers.get(`x-ratelimit-reset-${key}`), now),
    });
  }
  if (!windows.length) return;
  const at = new Date(now).toISOString();
  return {
    status: 'available',
    source: `Header respons API · ${model}`,
    checkedAt: at,
    observedAt: at,
    windows,
    note: 'Limit dari respons terakhir untuk model ini. Pemakaian di aplikasi lain dapat mengubah sisa limit.',
  };
}
