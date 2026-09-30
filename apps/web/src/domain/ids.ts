export function newId(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${raw.slice(0, 20)}` : raw.slice(0, 24);
}

export function nowIso(): string {
  return new Date().toISOString();
}
