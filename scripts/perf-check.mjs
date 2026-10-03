const apiBase = String(process.env.SONARA_API_URL || 'http://localhost:4000/api').replace(/\/$/, '');
const audioUrl = process.env.SONARA_AUDIO_URL || '';

const measure = async (label, url, options = {}) => {
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, options);
    const firstByte = performance.now();
    const body = await response.arrayBuffer();
    const finished = performance.now();
    return {
      endpoint: label,
      status: response.status,
      ttfbMs: Math.round(firstByte - started),
      totalMs: Math.round(finished - started),
      bytes: body.byteLength,
      compressed: response.headers.get('content-encoding') || 'none'
    };
  } catch (error) {
    return { endpoint: label, status: 'error', error: error.message };
  }
};

const rows = [
  await measure('/api/health', `${apiBase}/health`),
  await measure('/api/catalog', `${apiBase}/catalog`),
  await measure('/api/recommendations/daily', `${apiBase}/recommendations/daily?tz=UTC&deviceId=00000000-0000-4000-8000-000000000000`)
];
if (audioUrl) rows.push(await measure('audio range', audioUrl, { headers: { Range: 'bytes=0-1' } }));
console.table(rows);
