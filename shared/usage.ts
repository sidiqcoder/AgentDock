import type { QuotaSnapshot } from './types.js';

export function ageQuota(quota: QuotaSnapshot, now = Date.now()): QuotaSnapshot {
  if (!quota.windows.length || quota.status === 'stale') return quota;
  const age = now - Date.parse(quota.observedAt || quota.checkedAt);
  if (age > 300000 || quota.windows.some((w) => w.resetsAt && Date.parse(w.resetsAt) <= now)) {
    return {
      ...quota,
      status: 'stale',
      note: `${quota.note} Data lama; sisa limit perlu diperbarui. Angka belum diasumsikan reset.`,
    };
  }
  return quota;
}
