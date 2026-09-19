export function normalizeRelativeKey(filePath = '') {
  const value = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..');

  return parts.length ? parts.join('/') : 'untitled-file';
}

export function buildObjectKey(filePath = '', prefix = 'uploads') {
  const normalized = normalizeRelativeKey(filePath);
  const key = normalized.startsWith(`${prefix}/`) ? normalized : `${prefix}/${normalized}`;
  return key.replace(/\/+/g, '/');
}

export function buildPublicUrl(key = '', publicBaseUrl = '') {
  const cleanKey = String(key || '').replace(/^\/+/, '');
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');

  if (!cleanKey) {
    return base || '';
  }

  return base ? `${base}/${cleanKey}` : cleanKey;
}

export function isAudioFile(fileName = '') {
  return ['.mp3', '.wav', '.flac', '.m4a', '.aac'].some((ext) =>
    String(fileName).toLowerCase().endsWith(ext)
  );
}

export function isImageFile(fileName = '') {
  return ['.jpg', '.jpeg', '.png', '.webp'].some((ext) =>
    String(fileName).toLowerCase().endsWith(ext)
  );
}
