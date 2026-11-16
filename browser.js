export function webUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}

export function newId() {
  return crypto.randomUUID?.()
    ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
