export async function api<T = { ok: boolean }>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (response.status === 404 && json.error === 'Endpoint tidak ditemukan.') {
    throw new Error(
      'Fitur ini belum tersedia pada server Agent Dock yang sedang berjalan. Tutup Agent Dock melalui ikon tray, jalankan kembali, lalu muat ulang dashboard.',
    );
  }
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}
