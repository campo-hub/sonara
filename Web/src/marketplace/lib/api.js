import { getCurrentUser } from '../hooks/authState.js';

const env = import.meta.env || {};
export const API_URL = String(env.VITE_API_URL || '').replace(/\/+$/, '');

export function createApiClient({ baseUrl, fetcher = fetch, tokenProvider = async () => null }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  function apiUrl(path) {
    if (!base) throw new Error('The marketplace API URL is not configured for this build.');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = await tokenProvider();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetcher(apiUrl(path), { ...options, headers, credentials: 'omit' });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === 'object' ? payload?.error?.message || payload?.error?.code : '';
      throw new Error(message || `Request failed (${response.status}).`);
    }
    return payload;
  }
  return {
    request,
    get: (path, options) => request(path, options),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data ?? {}) }),
    put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data ?? {}) }),
    patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),
    del: (path) => request(path, { method: 'DELETE' })
  };
}

const defaultClient = createApiClient({
  baseUrl: API_URL,
  tokenProvider: async () => {
    const user = getCurrentUser();
    return user ? user.getIdToken() : null;
  }
});
export const apiRequest = defaultClient.request;
export const get = defaultClient.get;
export const post = defaultClient.post;
export const put = defaultClient.put;
export const patch = defaultClient.patch;
export const del = defaultClient.del;

export function upload(path, formData, onProgress = () => {}, method = 'POST') {
  const user = getCurrentUser();
  return Promise.resolve(user ? user.getIdToken() : null).then((token) => new Promise((resolve, reject) => {
    if (!API_URL) {
      reject(new Error('The marketplace API URL is not configured for this build.'));
      return;
    }
    const request = new XMLHttpRequest();
    request.open(method, `${API_URL}${path.startsWith('/') ? path : `/${path}`}`);
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let payload;
      try { payload = JSON.parse(request.responseText); } catch { payload = request.responseText; }
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else reject(new Error(payload?.error?.message || `Upload failed (${request.status}).`));
    });
    request.addEventListener('error', () => reject(new Error('Upload failed. Check your connection and try again.')));
    request.send(formData);
  }));
}
