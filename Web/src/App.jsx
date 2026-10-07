import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authenticatedJsonRequest, createAccountWithEmail, getCurrentIdToken, isFirebaseConfigured, signInWithEmail, signInWithGoogle, signOutUser, subscribeToAuth, updateUserProfile } from './firebaseAuth';
import { buildDailyMix, clearCachedCatalog, getCachedCatalog, isSampleCatalog, loadCachedRecommendations, loadCachedSavedMixes, loadFeaturedHistory, loadPlayHistory, mergePlaylistList, normalizePlaylistShape, pickRandomFeaturedTrack, qualifiesForPlayHistory, saveCachedCatalog, saveCachedRecommendations, saveCachedSavedMixes, saveFeaturedHistory, savePlayHistory, updatePlayHistory } from './catalogUtils.js';
import { buildAccentPalette } from './colorUtils.js';
import { queryCache } from './lib/queryCache.js';
import { createRouteHash, parseHashRoute } from './lib/routes.js';
import { useActionMap } from './lib/useAction.js';
import { ProgressSteps } from './lib/ProgressSteps.jsx';
import { useMixGridFit, useVisibleCount } from './lib/useFit.js';

/* -------------------------------------------------------------------------- */
/*  Config                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Previously this fell back to a hardcoded Render URL when VITE_API_URL
 * wasn't set. That URL drifted out of sync with whatever was actually
 * live (a different value was baked in by CI, another by local .env, and
 * a third was the real Render dashboard URL) - so a missing env var
 * failed silently and pointed at the wrong, possibly-dead host instead
 * of failing loudly. Now: no env var means no guessed fallback. The app
 * still runs (so you can see the UI), but every network call is skipped
 * and a visible banner explains exactly what's missing.
 */
const CONFIGURED_API_BASE = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
const isLocalDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const apiBase = CONFIGURED_API_BASE || (isLocalDev ? 'http://localhost:4000/api' : '');
const API_MISCONFIGURED = !apiBase;
const STORAGE_KEY = 'sonara.web.prefs.v2';
const CATALOG_TIMEOUT_MS = 8000;
const CATALOG_ETAG_KEY = 'sonara.web.catalog.etag.v1';
const CATALOG_RETRY_DELAYS = [1500, 4000];
const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|wma|m4b|m4r)$/i;
const adminCacheKeys = (uid) => {
  const prefix = `admin:${uid || 'anonymous'}`;
  return { summary: `${prefix}:summary` };
};
const invalidateAdminCache = (uid) => Object.values(adminCacheKeys(uid)).forEach((key) => queryCache.invalidate(key));
const playlistsCacheKey = (uid) => `user:${uid || 'anonymous'}:playlists`;

const fallbackCatalog = [
  { id: 'seed-night-drive', title: 'Night Drive', artist: 'Sonara Studio', album: 'Afterglow', seconds: 232, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', addedAt: Date.now() - 1000 },
  { id: 'seed-dream-state', title: 'Dream State', artist: 'North Echo', album: 'Late Bloom', seconds: 201, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', addedAt: Date.now() - 2000 },
  { id: 'seed-sunset-loop', title: 'Sunset Loop', artist: 'Glass Harbor', album: 'Warm Static', seconds: 246, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', addedAt: Date.now() - 3000 },
  { id: 'seed-hollow-glow', title: 'Hollow Glow', artist: 'Daybreak Ritual', album: 'Low Tide', seconds: 218, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', addedAt: Date.now() - 4000 },
  { id: 'seed-velvet-run', title: 'Velvet Run', artist: 'Cinder Avenue', album: 'Night Circuit', seconds: 247, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', addedAt: Date.now() - 5000 },
  { id: 'seed-lunar-kite', title: 'Lunar Kite', artist: 'Harbor Echo', album: 'Cassette Air', seconds: 261, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', addedAt: Date.now() - 6000 }
];

/* Accepts the shapes a backend commonly returns: [..], { songs }, { tracks }, { items }, { data: { songs } } ... */
const CATALOG_KEYS = ['songs', 'tracks', 'items', 'data', 'catalog', 'results'];
const pickSongs = (payload, depth = 0) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object' || depth > 2) return [];
  for (const key of CATALOG_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = pickSongs(value, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestWithTimeout = async (url, ms, headers = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'default', headers: { Accept: 'application/json', ...headers } });
  } finally {
    clearTimeout(timer);
  }
};

/* The two setup mistakes that most often make a deployed site look "broken". */
const describeConfigProblem = () => {
  if (API_MISCONFIGURED) {
    return 'VITE_API_URL was not set when this build was made, so the app has no backend address to call. Set VITE_API_URL (ending in /api) and rebuild.';
  }
  try {
    const local = ['localhost', '127.0.0.1', '[::1]'];
    const target = new URL(apiBase, window.location.href);
    if (local.includes(target.hostname) && !local.includes(window.location.hostname)) {
      return `This build calls ${target.origin}, which only exists on your own computer. Set VITE_API_URL to your Render URL (ending in /api) and rebuild.`;
    }
    if (window.location.protocol === 'https:' && target.protocol === 'http:') {
      return 'This page is https but the API address is http, so the browser blocks it. Use the https URL in VITE_API_URL.';
    }
  } catch {
    /* ignore */
  }
  return '';
};

const isAbortError = (error) => {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('aborted') || message.includes('signal is aborted');
};

const explainCatalogError = (error) => {
  if (error?.status === 404) return `The server answered 404, so ${apiBase}/catalog is not a route it knows. Check the URL and that /api is included.`;
  if (error?.status >= 500) return `The server answered ${error.status}. It may still be starting up, or it crashed. Check the Render logs.`;
  if (error?.status) return `The server answered ${error.status}.`;
  if (isAbortError(error)) return 'The server took too long to answer. Render free plans can need up to a minute to wake up.';
  return `The browser could not reach ${apiBase}/catalog. Render may still be waking up or returning a gateway error; check /api/health first. If health is available, then verify the server allows this site in its CORS settings.`;
};

const getUserDisplayName = (user) => {
  if (!user) return 'Listener';
  if (user.displayName) return user.displayName.trim();
  if (user.email) return user.email.split('@')[0] || 'Listener';
  return 'Listener';
};

const getDeviceId = () => {
  const key = 'sonara.web.device.id.v1';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return '00000000-0000-4000-8000-000000000000';
  }
};

const relativeTime = (timestamp) => {
  const elapsed = Math.max(0, Date.now() - Number(timestamp || 0));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return `${Math.floor(hours / 24)} d ago`;
};

/* Uploads run in groups so huge selections stay fast and cancellable. */
const BATCH_OPTIONS = [5, 10, 25, 50];
const DEFAULT_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 2;
const MAX_CONSECUTIVE_FAILURES = 3;

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'playlists', label: 'Playlists', icon: 'list' },
  { id: 'favorites', label: 'Favorites', icon: 'heart' },
  { id: 'upload', label: 'Upload', icon: 'upload' },
  { id: 'lab', label: 'Lab', icon: 'palette' }
];

const mobileTabs = ['home', 'library', 'playlists', 'lab'];
const protectedViews = new Set(['upload', 'playlists', 'favorites']);

const pageMeta = {
  library: { title: 'Library', subtitle: 'Everything you have saved, in one place.' },
  playlists: { title: 'Playlists', subtitle: 'Collections built around your sound and mood.' },
  favorites: { title: 'Favorites', subtitle: 'The songs you keep coming back to.' },
  upload: { title: 'Add music', subtitle: 'Bring in tracks, albums or whole folders. Big batches go in small groups.' },
  lab: { title: 'Appearance Lab', subtitle: 'Make Sonara look and feel the way you like.' },
  admin: { title: 'Admin', subtitle: 'Storage, catalog genres, and export batches.' }
};

const sortOptions = [
  { id: 'name', label: 'Name' },
  { id: 'artist', label: 'Artist' },
  { id: 'added', label: 'Date added' },
  { id: 'duration', label: 'Longest' }
];

const accentOptions = [
  { id: 'poppy', name: 'Poppy', dark: '#FF6B4A', light: '#D83A22' },
  { id: 'ochre', name: 'Ochre', dark: '#E5B04A', light: '#B7791F' },
  { id: 'moss', name: 'Moss', dark: '#8FB07A', light: '#4D6B3F' },
  { id: 'ink', name: 'Ink blue', dark: '#8FA9CC', light: '#2F4B6E' },
  { id: 'teal', name: 'Teal', dark: '#6FB5AE', light: '#2F7470' },
  { id: 'graphite', name: 'Graphite', dark: '#CFCBC0', light: '#2B2A27' }
];

const defaultPrefs = {
  theme: 'light',
  accent: 'poppy',
  customAccent: '#D83A22',
  accentIntensity: 'balanced',
  waveforms: true,
  compact: false,
  spin: true,
  volume: 0.8,
  liked: []
};

const defaultPlaylists = [
  { id: 'uploads', name: 'Uploads', description: 'Everything you have uploaded', dynamic: 'uploads', trackIds: [] }
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const formatTime = (value) => {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const parseTime = (value) => {
  if (typeof value === 'number') return value;
  const parts = String(value ?? '').split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatCount = (value) => Number(value || 0).toLocaleString();

const formatEta = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} hr ${minutes % 60} min left`;
};

const queueFraction = (queue) => {
  if (!queue || !queue.total) return 0;
  if (queue.status === 'done') return 1;
  const inFlight = queue.status === 'running' ? queue.batchProgress * queue.currentSize : 0;
  return Math.min(1, (queue.done + inFlight) / queue.total);
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const totalRuntime = (tracks) => {
  const minutes = Math.round(tracks.reduce((sum, track) => sum + track.seconds, 0) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const hashString = (value) => {
  let hash = 7;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
};

const waveHeights = (seed, count = 28) => {
  let state = seed || 1;
  return Array.from({ length: count }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return 4 + ((state >>> 24) % 15);
  });
};

const shuffled = (list) => {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};

const readableOn = (hex) => {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return '#0e0e0e';
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0e0e0e' : '#ffffff';
};

const resolveAssetUrl = (value) => {
  if (!value || typeof value !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('#') || !/[/.\\]/.test(value)) return '';
  try {
    const path = value.replace(/\\/g, '/').replace(/^\.\//, '');
    return new URL(path.startsWith('/') ? path : `/${path}`, new URL(apiBase, window.location.href).origin).toString();
  } catch {
    return '';
  }
};

const normalizeTrack = (item, index = 0) => {
  const seconds = parseTime(item?.duration ?? item?.seconds);
  return {
    id: String(item?.id ?? item?._id ?? `catalog-${index}`),
    title: item?.title || 'Untitled track',
    artist: item?.artist || 'Unknown artist',
    album: item?.album || 'Singles',
    seconds,
    cover: resolveAssetUrl(item?.cover || item?.artwork || item?.coverUrl),
    src: resolveAssetUrl(item?.audioUrl || item?.streamUrl || item?.url || item?.src || item?.fileUrl),
    addedAt: Date.parse(item?.createdAt || item?.uploadedAt || '') || Date.now() - index * 1000
  };
};

const groupBy = (tracks, getKeys) => {
  const map = new Map();
  tracks.forEach((track) => {
    getKeys(track).forEach((key) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(track);
    });
  });
  return [...map.entries()].map(([name, items]) => ({ name, items }));
};

const isAudioFile = (file) => {
  const type = (file?.type || '').toLowerCase();
  const name = (file?.webkitRelativePath || file?.name || '').toLowerCase();
  return type.startsWith('audio/') || AUDIO_EXTENSIONS.test(name);
};

/* Reads dropped files and, when a folder is dropped, walks it recursively. */
const readEntry = (entry) =>
  new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (file) => {
          try {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: entry.fullPath.replace(/^\//, ''),
              configurable: true
            });
          } catch {
            /* keep the plain file name */
          }
          resolve([file]);
        },
        () => resolve([])
      );
      return;
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () =>
        reader.readEntries(
          async (batch) => {
            if (!batch.length) {
              const nested = await Promise.all(collected.map(readEntry));
              resolve(nested.flat());
              return;
            }
            collected.push(...batch);
            readBatch();
          },
          () => resolve([])
        );
      readBatch();
      return;
    }

    resolve([]);
  });

const sendUpload = (formData, onProgress, run, token) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    if (run) run.abort = () => request.abort();
    request.open('POST', `${apiBase}/uploads/bulk`);
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.timeout = 15 * 60 * 1000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      let data = {};
      try {
        data = JSON.parse(request.responseText || '{}');
      } catch {
        /* response was not JSON */
      }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else reject(new Error(data.message || `Upload failed (${request.status}).`));
    };
    request.onerror = () => reject(new Error('Unable to reach the Sonara server.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));
    request.ontimeout = () => reject(new Error('The server took too long to respond.'));
    request.send(formData);
  });

const loadPrefs = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : defaultPrefs;
  } catch {
    return defaultPrefs;
  }
};

const loadStoredPrefKeys = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return new Set(parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
  } catch {
    return new Set();
  }
};

const SYNCABLE_PREF_KEYS = ['theme', 'accent', 'customAccent', 'accentIntensity', 'compact', 'spin', 'waveforms', 'volume'];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* -------------------------------------------------------------------------- */
/*  Icons                                                                     */
/* -------------------------------------------------------------------------- */

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  library: (
    <>
      <rect x="7" y="7" width="13" height="13" rx="2.5" />
      <path d="M4 16V6.5A2.5 2.5 0 0 1 6.5 4H16" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z" />
  ),
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.6-2.2-.4-1.2.4-2.3 1.6-2.3H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" />
      <path d="M7.5 11h.01M9.5 7.5h.01M14 7h.01M17 10h.01" />
    </>
  ),
  play: (
    <path
      d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"
      fill="currentColor"
      stroke="none"
    />
  ),
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  prev: (
    <>
      <path d="M6 5v14" />
      <path d="M19 5.5v13L9 12z" fill="currentColor" />
    </>
  ),
  next: (
    <>
      <path d="M18 5v14" />
      <path d="M5 5.5v13L15 12z" fill="currentColor" />
    </>
  ),
  shuffle: (
    <>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="m4 4 5 5" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  repeatOne: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      <path d="M11 10h1v4" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </>
  ),
  wave: <path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2" />,
  sparkle: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 16v4M17 18h4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  moon: <path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a7 7 0 0 0 10 10z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </>
  ),
  disc: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  expand: (
    <>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  )
};

function Icon({ name, size = 20, filled = false, className = '' }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small building blocks                                                     */
/* -------------------------------------------------------------------------- */

/* Earthy pigments for generated sleeves. Real artwork always wins over these. */
const SLEEVE_PALETTES = [
  ['#2F4B6E', '#EADBB8', '#D9A441'],
  ['#D9A441', '#16150F', '#F3EAD3'],
  ['#5E7B4F', '#F1E8D0', '#26251F'],
  ['#B4533C', '#F3E6D0', '#26251F'],
  ['#E2DAC6', '#2F4B6E', '#B4533C'],
  ['#26251F', '#D9A441', '#EAE2CF']
];

const SCAPE_TONES = [
  { bg: '#B4533C', fg: '#F6E9DA' },
  { bg: '#2F4B6E', fg: '#F1E9D6' },
  { bg: '#D9A441', fg: '#16150F' },
  { bg: '#5E7B4F', fg: '#F1E9D6' },
  { bg: '#E0D8C3', fg: '#16150F' },
  { bg: '#26251F', fg: '#F1E9D6' }
];

function SleeveShapes({ pattern, colors }) {
  const [base, a, b] = colors;
  switch (pattern) {
    case 0:
      return (
        <>
          <circle cx="50" cy="56" r="24" fill={a} />
          <rect x="0" y="66" width="100" height="34" fill={b} />
        </>
      );
    case 1:
      return (
        <>
          <path d="M14 100A36 36 0 0 1 86 100z" fill={a} />
          <path d="M28 100A22 22 0 0 1 72 100z" fill={b} />
          <path d="M40 100A10 10 0 0 1 60 100z" fill={base} />
        </>
      );
    case 2:
      return (
        <>
          {[0, 1, 2, 3, 4].map((index) => (
            <rect key={index} x={10 + index * 18} y="0" width="9" height="100" fill={a} />
          ))}
          <circle cx="50" cy="50" r="20" fill={b} />
        </>
      );
    case 3:
      return (
        <>
          <path d="M0 0H72A72 72 0 0 1 0 72z" fill={a} />
          <circle cx="74" cy="74" r="14" fill={b} />
        </>
      );
    case 4:
      return (
        <>
          <rect x="0" y="0" width="50" height="100" fill={a} />
          <circle cx="50" cy="50" r="24" fill={b} />
        </>
      );
    default:
      return (
        <>
          {[0, 1, 2].flatMap((row) =>
            [0, 1, 2].map((col) => (
              <circle key={`${row}-${col}`} cx={22 + col * 28} cy={22 + row * 28} r={(row + col) % 2 ? 7 : 11} fill={(row + col) % 2 ? b : a} />
            ))
          )}
        </>
      );
  }
}

function CoverArt({ track, size = 'md', round = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.cover]);
  const shape = round ? ' is-round' : '';

  if (track?.cover && !failed) {
    return <img className={`cover cover-${size}${shape}`} src={track.cover} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }

  const seed = hashString(track?.id || track?.title || 'sonara');
  const colors = SLEEVE_PALETTES[(seed >>> 3) % SLEEVE_PALETTES.length];

  return (
    <span className={`cover cover-${size}${shape}`} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <rect width="100" height="100" fill={colors[0]} />
        <SleeveShapes pattern={seed % 6} colors={colors} />
      </svg>
    </span>
  );
}

/* A vinyl record. The label shows the cover and it turns while music plays. */
function Record({ track, playing = false, spin = true }) {
  return (
    <span className={`record ${playing && spin ? 'is-spinning' : ''}`} aria-hidden="true">
      <span className="record-disc">
        <span className="record-label">{track ? <CoverArt track={track} size="fill" round /> : null}</span>
      </span>
    </span>
  );
}

/* Sleeve with the record sliding out of it. */
function SleeveStack({ track, playing, spin, onClick, label = 'Open now playing' }) {
  const body = (
    <>
      <span className="stack-record">
        <Record track={track} playing={playing} spin={spin} />
      </span>
      <span className="stack-sleeve">
        <CoverArt track={track} size="fill" />
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="sleeve-stack is-button" onClick={onClick} aria-label={label}>
      {body}
    </button>
  ) : (
    <div className="sleeve-stack">{body}</div>
  );
}

function Waveform({ seed, active }) {
  const bars = useMemo(() => waveHeights(seed), [seed]);
  return (
    <svg className={`wave ${active ? 'is-active' : ''}`} viewBox="0 0 84 20" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((height, index) => (
        <rect key={index} x={index * 3} y={10 - height / 2} width="2" height={height} rx="1" />
      ))}
    </svg>
  );
}

function DjButton({ active, onClick, idleLabel = 'Start DJ', className = '' }) {
  return (
    <button type="button" className={`dj-pill ${active ? 'is-on' : ''} ${className}`.trim()} onClick={onClick} aria-pressed={active}>
      <Icon name={active ? 'wave' : 'sparkle'} size={16} />
      {active ? 'Stop DJ' : idleLabel}
    </button>
  );
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </div>
  );
}

function SectionHead({ title, note, action }) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon = 'music', title, text, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

/* Each page gets its own pigment banner, so color comes from the room and not from big type. */
const BANNER_STYLES = {
  library: { bg: '#2F4B6E', fg: '#F1E9D6', palette: 0, pattern: 1 },
  playlists: { bg: '#5E7B4F', fg: '#F1E9D6', palette: 2, pattern: 3 },
  favorites: { bg: '#B4533C', fg: '#F6E9DA', palette: 3, pattern: 4 },
  upload: { bg: '#26251F', fg: '#F1E9D6', palette: 5, pattern: 2 },
  lab: { bg: '#E0D8C3', fg: '#16150F', palette: 4, pattern: 5 }
};

/* The now-spinning card borrows a pigment from the record on the deck. */
const tintFor = (track) => {
  if (!track || track.cover) return { bg: 'var(--deck-bg)', fg: 'var(--deck-fg)' };
  const index = ((hashString(track.id || track.title || 'sonara') >>> 3) + 2) % SLEEVE_PALETTES.length;
  const base = SLEEVE_PALETTES[index][0];
  return { bg: base, fg: readableOn(base) === '#0e0e0e' ? '#16150F' : '#F6EFE0' };
};

function PageBanner({ id, title, subtitle }) {
  const style = BANNER_STYLES[id] || BANNER_STYLES.library;
  return (
    <header className="banner" style={{ '--tone-bg': style.bg, '--tone-fg': style.fg }}>
      <div className="banner-copy">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <svg className="banner-art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <SleeveShapes pattern={style.pattern} colors={SLEEVE_PALETTES[style.palette]} />
      </svg>
    </header>
  );
}

function UsernameDialog({ onComplete }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/profile`, {
        method: 'PUT',
        body: JSON.stringify({ username })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save username.');
      onComplete(data.profile);
    } catch (saveError) {
      setError(saveError?.message || 'Unable to save username.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-backdrop">
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="username-title">
        <span className="auth-kicker">Personalize Sonara</span>
        <h2 id="username-title">Choose your username</h2>
        <p className="auth-reason">This name is tied to your account and must be unique.</p>
        <form onSubmit={submit}>
          <label className="auth-field"><span>Username</span><input type="text" value={username} onChange={(event) => setUsername(event.target.value)} minLength="2" maxLength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,29}" autoFocus required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        </form>
      </section>
    </div>
  );
}

function AuthDialog({ mode, reason, hasAdmin, onClaimAdmin, onClose, onSignedIn, onModeChange }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (result) => onSignedIn(result.user, mode === 'register' ? username.trim() : '');
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      finish(mode === 'register' ? await createAccountWithEmail(email, password) : await signInWithEmail(email, password));
    } catch (authError) {
      setError(authError?.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };
  const google = async () => {
    setBusy(true);
    setError('');
    try { finish(await signInWithGoogle()); } catch (authError) { setError(authError?.message || 'Google sign-in failed.'); } finally { setBusy(false); }
  };

  return (
    <div className="auth-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="icon-btn auth-close" onClick={onClose} aria-label="Close authentication"><Icon name="x" size={20} /></button>
        <span className="auth-kicker">Sonara account</span>
        <h2 id="auth-title">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
        <p className="auth-reason">{reason}</p>
        {!hasAdmin && (
          <button
            type="button"
            className="btn auth-claim-admin"
            style={{
              width: '100%',
              marginBottom: '1rem',
              background: 'linear-gradient(135deg, #FFD700, #FF8C00)',
              color: '#000',
              fontWeight: 'bold',
              border: 'none',
              borderRadius: '12px',
              padding: '0.75rem'
            }}
            onClick={onClaimAdmin}
            disabled={busy}
          >
            👑 Claim Admin Account (One-Time Setup)
          </button>
        )}
        <button type="button" className="btn auth-google" onClick={google} disabled={busy || !isFirebaseConfigured}>Continue with Google</button>
        <div className="auth-divider"><span>or use email</span></div>
        <form onSubmit={submit}>
          <label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" required /></label>
          {mode === 'register' && <label className="auth-field"><span>Username</span><input type="text" value={username} onChange={(event) => setUsername(event.target.value)} minLength="2" maxLength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,29}" required /></label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-wide" disabled={busy || !isFirebaseConfigured}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
        </form>
        <button type="button" className="text-btn auth-switch" onClick={() => onModeChange(mode === 'register' ? 'signin' : 'register')}>{mode === 'register' ? 'Already have an account? Sign in' : 'New to Sonara? Create an account'}</button>
      </section>
    </div>
  );
}

function SeekBar({ position, total, onSeek, disabled }) {
  const max = Math.max(total, 1);
  const percent = Math.min(100, (position / max) * 100);
  return (
    <div className="seek">
      <span className="seek-time">{formatTime(position)}</span>
      <input
        type="range"
        className="slider"
        min="0"
        max={max}
        step="0.1"
        value={Math.min(position, max)}
        disabled={disabled}
        style={{ '--fill': `${percent}%` }}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Seek"
      />
      <span className="seek-time">{formatTime(total)}</span>
    </div>
  );
}

function TransportControls({ isPlaying, shuffle, repeat, disabled, onToggle, onNext, onPrevious, onShuffle, onRepeat }) {
  return (
    <div className="transport">
      <button type="button" className={`icon-btn ${shuffle ? 'is-active' : ''}`} onClick={onShuffle} aria-pressed={shuffle} aria-label="Shuffle" disabled={disabled}>
        <Icon name="shuffle" size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={onPrevious} aria-label="Previous track" disabled={disabled}>
        <Icon name="prev" size={20} />
      </button>
      <button type="button" className="play-fab" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'} disabled={disabled}>
        <Icon name={isPlaying ? 'pause' : 'play'} size={22} />
      </button>
      <button type="button" className="icon-btn" onClick={onNext} aria-label="Next track" disabled={disabled}>
        <Icon name="next" size={20} />
      </button>
      <button type="button" className={`icon-btn ${repeat !== 'off' ? 'is-active' : ''}`} onClick={onRepeat} aria-label={`Repeat: ${repeat}`} disabled={disabled}>
        <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} />
      </button>
    </div>
  );
}


function Tracklist({ tracks, currentId, isPlaying, likedIds, onPlay, onToggleLike, onAddToPlaylist, onRemoveFromPlaylist, showWaveform }) {
  return (
    <ol className="tracklist">
      {tracks.map((track, index) => {
        const isCurrent = track.id === currentId;
        const isLiked = likedIds.has(track.id);
        const detail = track.album && track.album !== 'Singles' ? `${track.artist} · ${track.album}` : track.artist;
        return (
          <li key={track.id} className={`tl-row ${isCurrent ? 'is-current' : ''} ${isCurrent && isPlaying ? 'is-playing' : ''}`} onDoubleClick={() => onPlay(index)}>
            <button type="button" className="tl-play" onClick={() => onPlay(index)} aria-label={`${isCurrent && isPlaying ? 'Pause' : 'Play'} ${track.title}`}>
              <span className="tl-num">{String(index + 1).padStart(2, '0')}</span>
              <span className="tl-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <Icon name={isCurrent && isPlaying ? 'pause' : 'play'} size={16} className="tl-icon" />
            </button>
            <div className="tl-title">
              <CoverArt track={track} size="sm" />
              <div className="tl-text">
                <strong>{track.title}</strong>
                <span>{detail}</span>
              </div>
            </div>
            <span className="tl-lead" aria-hidden="true">
              <i className="tl-dots" />
              {showWaveform && <Waveform seed={hashString(track.id)} active={isCurrent} />}
            </span>
            <span className="tl-time">{formatTime(track.seconds)}</span>
            {onAddToPlaylist && (
              <button type="button" className="icon-btn playlist-add" onClick={() => onAddToPlaylist(track)} aria-label={`Add ${track.title} to a playlist`}>
                <Icon name="plus" size={18} />
              </button>
            )}
            {onRemoveFromPlaylist && (
              <button type="button" className="icon-btn playlist-remove" onClick={() => onRemoveFromPlaylist(track.id)} aria-label={`Remove ${track.title} from this playlist`}>
                <Icon name="x" size={18} />
              </button>
            )}
            <button type="button" className={`icon-btn heart ${isLiked ? 'is-on' : ''}`} onClick={() => onToggleLike(track.id)} aria-pressed={isLiked} aria-label={isLiked ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}>
              <Icon name="heart" size={19} filled={isLiked} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function UploadQueue({ queue, onCancel, onDismiss }) {
  const running = queue.status === 'running';
  const percent = Math.floor(queueFraction(queue) * 100);
  const inFlight = running ? queue.batchProgress * queue.currentSize : 0;
  const untouched = Math.max(0, queue.total - queue.done - queue.failed);
  const elapsed = (Date.now() - queue.startedAt) / 1000;
  const rate = running && elapsed > 3 ? (queue.done + inFlight) / elapsed : 0;
  const eta = rate > 0 ? formatEta((untouched - inFlight) / rate) : '';

  const titles = {
    running: queue.cancelling ? 'Cancelling…' : 'Taking your music in',
    done: 'All done',
    cancelled: 'Upload cancelled',
    partial: 'Finished with a few misses',
    stopped: 'Upload stopped'
  };

  let detail = '';
  if (running) {
    detail = [`Group ${formatCount(queue.batch)} of ${formatCount(queue.batches)}`, queue.batchProgress >= 1 ? 'processing on the server' : '', eta].filter(Boolean).join(' · ');
  } else if (queue.status === 'done') {
    detail = 'Every track was uploaded.';
  } else if (queue.status === 'cancelled') {
    detail = `${formatCount(queue.done)} uploaded before you cancelled. ${formatCount(queue.remaining)} ${queue.remaining === 1 ? 'track is' : 'tracks are'} still selected.`;
  } else if (queue.status === 'partial') {
    detail = `${formatCount(queue.failed)} ${queue.failed === 1 ? 'track' : 'tracks'} could not be uploaded and stayed selected so you can retry.`;
  } else {
    detail = `Stopped after repeated errors${queue.error ? `: ${queue.error.replace(/\.$/, '')}` : ''}. ${formatCount(queue.remaining)} ${queue.remaining === 1 ? 'track is' : 'tracks are'} still selected.`;
  }

  return (
    <section className={`queue-card is-${queue.status}`} aria-label="Upload queue">
      <div className="queue-head">
        <span className="queue-title">
          {running ? <span className="spinner" aria-hidden="true" /> : <Icon name={queue.status === 'done' ? 'check' : 'x'} size={18} />}
          {titles[queue.status]}
        </span>
        {running ? (
          <button type="button" className="btn btn-cancel" onClick={onCancel} disabled={queue.cancelling}>
            <Icon name="x" size={16} />
            {queue.cancelling ? 'Cancelling…' : 'Cancel upload'}
          </button>
        ) : (
          <button type="button" className="text-btn" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      <div className="queue-count" aria-live="polite">
        <strong>{formatCount(queue.done)}</strong>
        <span>/ {formatCount(queue.total)}</span>
        <em>{percent}%</em>
      </div>

      <div className="progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
        <i style={{ width: `${percent}%` }} />
      </div>

      {queue.groups && queue.groups.length > 1 && (
        <div className="queue-ticks" aria-hidden="true" title="One mark per group">
          {queue.groups.map((state, index) => (
            <i key={index} className={`tick is-${state} ${running && index === queue.batch - 1 && state === 'pending' ? 'is-current' : ''}`} />
          ))}
        </div>
      )}

      <p className="queue-detail">{detail}</p>

      <div className="queue-stats">
        <div>
          <span>Uploaded</span>
          <strong>{formatCount(queue.done)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{formatCount(untouched)}</strong>
        </div>
        <div>
          <span>Failed</span>
          <strong>{formatCount(queue.failed)}</strong>
        </div>
      </div>

      {running && queue.current.length > 0 && (
        <div className="queue-files">
          <small>In this group</small>
          <ul>
            {queue.current.slice(0, 4).map((name, index) => (
              <li key={`${name}-${index}`}>
                <Icon name="music" size={14} />
                <span>{name}</span>
              </li>
            ))}
          </ul>
          {queue.current.length > 4 && <p>and {queue.current.length - 4} more in this group</p>}
        </div>
      )}
    </section>
  );
}

/* Full-screen Now Playing. Escape closes it. */
function Stage({ track, isPlaying, spin, isLiked, onLike, contextLabel, upNext, onJump, djOn, onDj, onClose, position, total, onSeek, onToggle, onNext, onPrevious, shuffle, repeat, onShuffle, onRepeat }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!track) return null;

  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Now playing">
      <div className="stage-top">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close now playing">
          <Icon name="chevronDown" size={24} />
        </button>
        <div className="stage-context">
          <small>Playing from</small>
          <strong>{contextLabel}</strong>
        </div>
        <span className="stage-spacer" />
      </div>

      <div className="stage-body">
        <div className="stage-visual">
          <SleeveStack track={track} playing={isPlaying} spin={spin} />
        </div>

        <div className="stage-info">
          <h2>{track.title}</h2>
          <p className="stage-artist">{track.artist}</p>

          <div className="stage-actions">
            <button type="button" className={`icon-btn heart ${isLiked ? 'is-on' : ''}`} onClick={onLike} aria-pressed={isLiked} aria-label={isLiked ? 'Remove from favorites' : 'Add to favorites'}>
              <Icon name="heart" size={22} filled={isLiked} />
            </button>
            <DjButton active={djOn} onClick={onDj} idleLabel="Start DJ session" />
          </div>

          <div className="stage-transport">
            <SeekBar position={position} total={total} onSeek={onSeek} />
            <TransportControls isPlaying={isPlaying} shuffle={shuffle} repeat={repeat} onToggle={onToggle} onNext={onNext} onPrevious={onPrevious} onShuffle={onShuffle} onRepeat={onRepeat} />
          </div>

          <div className="stage-queue">
            <h3>Up next</h3>
            {upNext.length ? (
              <ul>
                {upNext.map(({ track: item, index }) => (
                  <li key={`${item.id}-${index}`}>
                    <button type="button" onClick={() => onJump(index)}>
                      <CoverArt track={item} size="xs" />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.artist}</small>
                      </span>
                      <em>{formatTime(item.seconds)}</em>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="stage-empty">Nothing queued after this track.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  App                                                                       */
/* -------------------------------------------------------------------------- */

export default function App() {
  /* navigation + preferences */
  const initialRoute = parseHashRoute(window.location.hash);
  const [view, setView] = useState(initialRoute.view);
  const [playlistId, setPlaylistId] = useState('');
  const [libraryTab, setLibraryTab] = useState(initialRoute.libraryTab || 'songs');
  const [labTab, setLabTab] = useState('themes');
  const [query, setQuery] = useState(initialRoute.query || '');
  const [sortKey, setSortKey] = useState('name');
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [dailyRecommendations, setDailyRecommendations] = useState(() => ({ state: loadCachedRecommendations() ? 'ready' : 'loading', ...(loadCachedRecommendations() || { dateKey: '', mixes: [], next: null }) }));
  const [savedMixes, setSavedMixes] = useState([]);
  const [recommendationRefresh, setRecommendationRefresh] = useState(0);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [featuredHistory, setFeaturedHistory] = useState(loadFeaturedHistory);
  const [playHistory, setPlayHistory] = useState(loadPlayHistory);
  const [notice, setNotice] = useState('');
  const routeScrollPositionsRef = useRef(new Map());
  const activeRouteHashRef = useRef(initialRoute.hash);
  const playProgressRef = useRef({ trackId: '', lastTime: 0, listenedSeconds: 0, qualified: false });
  const localPrefKeysRef = useRef(loadStoredPrefKeys());
  const dirtyPrefKeysRef = useRef(new Set());
  const [stageOpen, setStageOpen] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authReason, setAuthReason] = useState('Sign in to unlock this feature.');
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [pendingAdminClaim, setPendingAdminClaim] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [genrePlaylists, setGenrePlaylists] = useState([]);
  const [playlistMenuTrack, setPlaylistMenuTrack] = useState(null);
  const [playlistComposer, setPlaylistComposer] = useState(null);
  const [playlistDraft, setPlaylistDraft] = useState('');
  const [libraryHydrated, setLibraryHydrated] = useState(false);
  const didInitialLibrarySync = useRef(false);

  /* Admin & Billing states */
  const [hasAdmin, setHasAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminCounts, setAdminCounts] = useState({ pending: 0, exported: 0, classified: 0, needsReview: 0 });
  const [adminBatches, setAdminBatches] = useState([]);
  const [adminExportSize, setAdminExportSize] = useState(200);
  const [adminCsvText, setAdminCsvText] = useState('');
  const [adminCsvName, setAdminCsvName] = useState('');
  const [adminPreview, setAdminPreview] = useState(null);
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [adminStatsUpdatedAt, setAdminStatsUpdatedAt] = useState(0);
  const adminActions = useActionMap();
  const [adminActivityOpen, setAdminActivityOpen] = useState(false);
  const [adminActivity, setAdminActivity] = useState([]);
  const [adminCostSearch, setAdminCostSearch] = useState('');
  const [adminCostSort, setAdminCostSort] = useState('totalBytes');
  const [adminCostSortDirection, setAdminCostSortDirection] = useState(-1);
  const [adminCopiedEmail, setAdminCopiedEmail] = useState('');

  useEffect(() => {
    let restoreFrame = 0;
    const syncRoute = () => {
      const previousHash = activeRouteHashRef.current;
      if (previousHash && previousHash !== window.location.hash) {
        routeScrollPositionsRef.current.set(previousHash, window.scrollY);
      }
      const route = parseHashRoute(window.location.hash);
      if (route.hash !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${route.hash}`);
      }
      activeRouteHashRef.current = route.hash;
      setView(route.view);
      setLibraryTab(route.libraryTab || 'songs');
      setPlaylistId(route.playlistId || '');
      setQuery(route.query || '');
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(() => {
        window.scrollTo(0, routeScrollPositionsRef.current.get(route.hash) || 0);
      });
    };

    window.addEventListener('hashchange', syncRoute);
    syncRoute();
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      cancelAnimationFrame(restoreFrame);
    };
  }, []);

  useEffect(() => {
    const isLivingRoom = () => window.innerWidth >= 2560;
    const handleRemoteKeys = (event) => {
      if (!isLivingRoom()) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape' || event.key === 'Backspace') {
        if (window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
        return;
      }
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = directions[event.key];
      if (!direction) return;
      const candidates = [...document.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
      if (!candidates.length) return;
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const currentIndex = candidates.indexOf(current);
      if (currentIndex < 0) {
        event.preventDefault();
        candidates[0].focus();
        return;
      }
      const origin = candidates[currentIndex].getBoundingClientRect();
      const originX = origin.left + origin.width / 2;
      const originY = origin.top + origin.height / 2;
      const [stepX, stepY] = direction;
      const next = candidates.map((element) => {
        const rect = element.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - originX;
        const dy = rect.top + rect.height / 2 - originY;
        const primary = stepX ? dx * stepX : dy * stepY;
        if (primary <= 0) return null;
        const secondary = stepX ? Math.abs(dy) : Math.abs(dx);
        return { element, score: primary + secondary * 1.5 };
      }).filter(Boolean).sort((left, right) => left.score - right.score)[0];
      if (next) {
        event.preventDefault();
        next.element.focus();
      }
    };
    window.addEventListener('keydown', handleRemoteKeys);
    return () => window.removeEventListener('keydown', handleRemoteKeys);
  }, []);

  useEffect(() => {
    fetch(`${apiBase}/admin/check`)
      .then((res) => res.json())
      .then((data) => setHasAdmin(Boolean(data?.hasAdmin)))
      .catch(() => setHasAdmin(true));
  }, []);

  useEffect(() => {
    if (!authUser) {
      setIsAdmin(false);
      return;
    }
    (async () => {
      try {
        const res = await authenticatedJsonRequest(`${apiBase}/admin/me`);
        const data = await res.json();
        setIsAdmin(Boolean(data?.isAdmin));
      } catch {
        setIsAdmin(false);
      }
    })();
  }, [authUser]);

  const claimAdminForUser = useCallback(async (user) => {
    try {
      const res = await authenticatedJsonRequest(`${apiBase}/admin/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email || 'admin@sonara.app', displayName: user?.displayName || '' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to claim admin account.');
      setHasAdmin(true);
      setIsAdmin(true);
      setNotice('Admin account claimed.');
      setView('admin');
      setAuthOpen(false);
    } catch (err) {
      setNotice(err.message || 'Failed to claim admin account.');
    }
  }, []);

  const handleClaimAdmin = async () => {
    if (!authUser) {
      setPendingAdminClaim(true);
      setAuthMode('signin');
      setAuthReason('Sign in to claim the one-time admin account.');
      return;
    }
    await claimAdminForUser(authUser);
  };

  const loadAdminStats = useCallback(async () => {
    setAdminLoading(true);
    try {
      const res = await authenticatedJsonRequest(`${apiBase}/admin/stats`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unable to load admin stats.');
      setAdminStats(data);
    } catch (err) {
      setNotice(err.message || 'Failed to load billing metrics.');
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const loadAdminCatalog = useCallback(async () => {
    try {
      const [countResponse, batchesResponse] = await Promise.all([
        authenticatedJsonRequest(`${apiBase}/admin/catalog/pending-count`),
        authenticatedJsonRequest(`${apiBase}/admin/catalog/exports`)
      ]);
      const counts = await countResponse.json();
      const batches = await batchesResponse.json();
      if (!countResponse.ok) throw new Error(counts.message || 'Unable to load catalog status.');
      if (!batchesResponse.ok) throw new Error(batches.message || 'Unable to load export batches.');
      setAdminCounts(counts);
      setAdminBatches(Array.isArray(batches.batches) ? batches.batches : []);
    } catch (err) {
      setNotice(err.message || 'Unable to load catalog export status.');
    }
  }, []);

  const downloadAdminBatch = useCallback(async (batchId) => {
    setAdminActionLoading(true);
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/admin/catalog/exports/${encodeURIComponent(batchId)}.csv`);
      if (!response.ok) throw new Error((await response.json()).message || 'Unable to download this batch.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sonara-${batchId}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err.message || 'Unable to download this batch.');
    } finally {
      setAdminActionLoading(false);
    }
  }, []);

  const exportAdminBatch = useCallback(async () => {
    setAdminActionLoading(true);
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/admin/catalog/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize: adminExportSize })
      });
      if (response.status === 204) {
        setNotice('No new songs are waiting for genres.');
        await loadAdminCatalog();
        return;
      }
      if (!response.ok) throw new Error((await response.json()).message || 'Unable to export the next batch.');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'sonara-export.csv';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Batch exported. Send that CSV to your classifier, then import the completed file below.');
      await loadAdminCatalog();
    } catch (err) {
      setNotice(err.message || 'Unable to export the next batch.');
    } finally {
      setAdminActionLoading(false);
    }
  }, [adminExportSize, loadAdminCatalog]);

  const previewAdminImport = useCallback(async () => {
    if (!adminCsvText.trim()) return setNotice('Paste or choose a batch CSV first.');
    setAdminActionLoading(true);
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/admin/catalog/import/batch/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: adminCsvText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to preview this batch.');
      setAdminPreview(data);
    } catch (err) {
      setNotice(err.message || 'Unable to preview this batch.');
    } finally {
      setAdminActionLoading(false);
    }
  }, [adminCsvText]);

  const loadAdminCsvFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setNotice('Choose a .csv file exported from Sonara.');
      return;
    }
    setAdminCsvName(file.name);
    setAdminCsvText(await file.text());
    setAdminPreview(null);
  }, []);

  const applyAdminImport = useCallback(async () => {
    if (!adminPreview?.ok) return;
    setAdminActionLoading(true);
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/admin/catalog/import/batch/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: adminPreview })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to apply this batch.');
      setAdminPreview(null);
      setAdminCsvText('');
      setNotice(`Imported ${data.changed?.length || 0} tracks. ${data.rejected?.invalidGenre?.length || 0} rows still need correction.`);
      await loadAdminCatalog();
    } catch (err) {
      setNotice(err.message || 'Unable to apply this batch.');
    } finally {
      setAdminActionLoading(false);
    }
  }, [adminPreview, loadAdminCatalog]);

  const updateAdminBatch = useCallback(async (batchId, action) => {
    setAdminActionLoading(true);
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/admin/catalog/exports/${encodeURIComponent(batchId)}/${action}`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Unable to ${action} this batch.`);
      setNotice(action === 'release' ? `Released ${data.released || 0} outstanding tracks.` : `Re-queued ${data.released || 0} outstanding tracks.`);
      await loadAdminCatalog();
    } catch (err) {
      setNotice(err.message || `Unable to ${action} this batch.`);
    } finally {
      setAdminActionLoading(false);
    }
  }, [loadAdminCatalog]);

  useEffect(() => {
    if (view === 'admin' && isAdmin) {
      loadAdminStats();
      loadAdminCatalog();
    }
  }, [view, isAdmin, loadAdminStats, loadAdminCatalog]);

  const handleAuthSuccess = useCallback(async (user, requestedUsername = '') => {
    setAuthUser(user);
    setAuthOpen(false);
    setAuthMode('signin');
    setAuthReason('Sign in to unlock this feature.');
    if (!user) return;
    if (requestedUsername) {
      try {
        const response = await authenticatedJsonRequest(`${apiBase}/me/profile`, { method: 'PUT', body: JSON.stringify({ username: requestedUsername }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to save username.');
        await updateUserProfile(user, data.profile.username);
        setAuthUser({ ...user, displayName: data.profile.username });
        setUsernameOpen(false);
      } catch (error) {
        setNotice(error.message || 'Unable to save username.');
        setUsernameOpen(true);
      }
    } else {
      setNotice(`Welcome back, ${getUserDisplayName(user)}.`);
    }
    if (pendingAdminClaim) {
      setPendingAdminClaim(false);
      await claimAdminForUser(user);
    }
  }, [claimAdminForUser, pendingAdminClaim]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOutUser();
    } finally {
      setAuthUser(null);
      setUserPlaylists([]);
      setSavedMixes([]);
      setLibraryHydrated(false);
      setNotice('Signed out.');
    }
  }, []);

  /* catalog + upload */
  const [catalog, setCatalog] = useState([]);
  const [sessionUploads, setSessionUploads] = useState([]);
  const [serverOnline, setServerOnline] = useState(null);
  const [catalogStatus, setCatalogStatus] = useState({ state: 'loading', message: '' });
  const catalogRequestRef = useRef(0);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadMode, setUploadMode] = useState('files');
  const [uploadMessage, setUploadMessage] = useState(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [uploadQueue, setUploadQueue] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  /* player */
  const initialQueue = useMemo(() => [], []);
  const [queue, setQueue] = useState(initialQueue);
  const [queueBase, setQueueBase] = useState(initialQueue);
  const [pos, setPos] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [djOn, setDjOn] = useState(false);
  const [muted, setMuted] = useState(false);
  const [contextLabel, setContextLabel] = useState('All Music');

  const audioRef = useRef(null);
  const audioSourceRef = useRef('');
  const nextAudioRef = useRef(null);
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const advanceRef = useRef(() => {});
  const uploadRunRef = useRef({ cancelled: false, abort: null });
  const controlsRef = useRef({});

  const isUploading = uploadQueue?.status === 'running';
  const uploadPercent = Math.floor(queueFraction(uploadQueue) * 100);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => subscribeToAuth(setAuthUser), []);
  useEffect(() => {
    setUsernameDraft(authUser ? getUserDisplayName(authUser) : '');
    setUsernameError('');
  }, [authUser]);

  const saveUsernameFromSettings = async () => {
    if (!authUser) {
      setAuthReason('Sign in to edit your username.');
      setAuthOpen(true);
      return;
    }
    setUsernameSaving(true);
    setUsernameError('');
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/profile`, {
        method: 'PUT',
        body: JSON.stringify({ username: usernameDraft.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save username.');
      await updateUserProfile(authUser, data.profile.username);
      setAuthUser({ ...authUser, displayName: data.profile.username });
      setNotice('Username updated.');
    } catch (error) {
      setUsernameError(error.message || 'Unable to save username.');
    } finally {
      setUsernameSaving(false);
    }
  };

  useEffect(() => {
    if (!authUser) return undefined;
    let active = true;
    authenticatedJsonRequest(`${apiBase}/me/profile`)
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!active || !response.ok) return;
        if (data.profile?.username) {
          updateUserProfile(authUser, data.profile.username).catch(() => {});
          setAuthUser({ ...authUser, displayName: data.profile.username });
        } else {
          setUsernameOpen(true);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [authUser]);

  const current = queue[pos] || null;
  const total = audioDuration || current?.seconds || 0;
  const resolvedTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  const likedIds = useMemo(() => new Set(prefs.liked), [prefs.liked]);

  const updatePrefs = useCallback((patch) => {
    Object.keys(patch || {}).forEach((key) => {
      localPrefKeysRef.current.add(key);
      dirtyPrefKeysRef.current.add(key);
    });
    setPrefs((previous) => ({ ...previous, ...patch }));
  }, []);

  const requireAuth = useCallback((reason) => {
    if (authUser) return true;
    setAuthReason(reason);
    setAuthOpen(true);
    return false;
  }, [authUser]);

  const refreshUserPlaylists = useCallback(async () => {
    if (!authUser) {
      setUserPlaylists([]);
      return;
    }
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load your playlists.');
      setUserPlaylists(mergePlaylistList(Array.isArray(data) ? data : []));
    } catch (error) {
      setNotice(error.message || 'Unable to load your playlists.');
    }
  }, [authUser]);

  const handleCreatePlaylist = useCallback(async (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (!requireAuth('Sign in to create playlists.')) return;
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to create playlist.');
      setUserPlaylists((previous) => mergePlaylistList([...previous, normalizePlaylistShape(data)]));
      setPlaylistId(data.id);
      setNotice(`Created “${data.name}”.`);
      setPlaylistComposer(null);
      setPlaylistDraft('');
      setPlaylistMenuTrack(null);
    } catch (error) {
      setNotice(error.message || 'Unable to create playlist.');
    }
  }, [authUser, requireAuth]);

  const handleRenamePlaylist = useCallback(async (playlistIdValue, name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (!requireAuth('Sign in to rename playlists.')) return;
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists/${playlistIdValue}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to rename playlist.');
      setUserPlaylists((previous) => mergePlaylistList(previous.map((playlist) => (playlist.id === playlistIdValue ? normalizePlaylistShape({ ...playlist, ...data }) : playlist))));
      setNotice(`Renamed playlist to “${data.name}”.`);
      setPlaylistComposer(null);
      setPlaylistDraft('');
    } catch (error) {
      setNotice(error.message || 'Unable to rename playlist.');
    }
  }, [authUser, requireAuth]);

  const handleDeletePlaylist = useCallback(async (playlistIdValue) => {
    if (!requireAuth('Sign in to delete playlists.')) return;
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists/${playlistIdValue}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to delete playlist.');
      setUserPlaylists((previous) => previous.filter((playlist) => playlist.id !== playlistIdValue));
      if (playlistId === playlistIdValue) setPlaylistId('');
      setNotice('Playlist deleted.');
      setPlaylistComposer(null);
    } catch (error) {
      setNotice(error.message || 'Unable to delete playlist.');
    }
  }, [authUser, requireAuth, playlistId]);

  const handleAddTrackToPlaylist = useCallback(async (playlistIdValue, trackId) => {
    if (!requireAuth('Sign in to add tracks to playlists.')) return;
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists/${playlistIdValue}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to add track to playlist.');
      setUserPlaylists((previous) => mergePlaylistList(previous.map((playlist) => (playlist.id === playlistIdValue ? normalizePlaylistShape({ ...playlist, ...data.playlist }) : playlist))));
      setNotice(`Added to “${userPlaylists.find((playlist) => playlist.id === playlistIdValue)?.name || 'playlist'}”.`);
      setPlaylistMenuTrack(null);
      setPlaylistDraft('');
    } catch (error) {
      setNotice(error.message || 'Unable to add track to playlist.');
    }
  }, [authUser, requireAuth, userPlaylists]);

  const handleRemoveTrackFromPlaylist = useCallback(async (playlistIdValue, trackId) => {
    if (!requireAuth('Sign in to remove tracks from playlists.')) return;
    try {
      const response = await authenticatedJsonRequest(`${apiBase}/me/playlists/${playlistIdValue}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to remove track from playlist.');
      setUserPlaylists((previous) => previous.map((playlist) => {
        if (playlist.id !== playlistIdValue) return playlist;
        const nextTrackIds = (playlist.trackIds || []).filter((id) => id !== trackId);
        return normalizePlaylistShape({ ...playlist, trackIds: nextTrackIds });
      }));
      setNotice('Track removed from playlist.');
    } catch (error) {
      setNotice(error.message || 'Unable to remove track from playlist.');
    }
  }, [authUser, requireAuth]);

  const toggleLike = useCallback((id) => {
    if (!requireAuth('Sign in to save favorites to your account.')) return;
    localPrefKeysRef.current.add('liked');
    dirtyPrefKeysRef.current.add('liked');
    setPrefs((previous) => ({
      ...previous,
      liked: previous.liked.includes(id) ? previous.liked.filter((item) => item !== id) : [...previous.liked, id]
    }));
  }, [requireAuth]);

  const authUid = authUser?.uid || null;
  const hydratedUidRef = useRef(null);

  useEffect(() => {
    let active = true;
    if (!authUid) {
      setSavedMixes([]);
      return () => { active = false; };
    }
    setSavedMixes(loadCachedSavedMixes(authUid));
    (async () => {
      try {
        const response = await authenticatedJsonRequest(`${apiBase}/me/mixes`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load your saved mixes.');
        if (active) {
          const mixes = Array.isArray(data) ? data : [];
          setSavedMixes(mixes);
          saveCachedSavedMixes(authUid, mixes);
        }
      } catch (error) {
        if (active) setNotice(error.message || 'Unable to load your saved mixes.');
      }
    })();
    return () => { active = false; };
  }, [authUid]);

  useEffect(() => {
    let active = true;
    if (!authUid) {
      setLibraryHydrated(false);
      setUserPlaylists([]);
      hydratedUidRef.current = null;
      didInitialLibrarySync.current = false;
      return undefined;
    }
    if (hydratedUidRef.current === authUid) return undefined;
    hydratedUidRef.current = authUid;
    (async () => {
      try {
        const response = await authenticatedJsonRequest(`${apiBase}/me/library`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load your library.');
        if (!active) return;
        const cloudPreferences = data.preferences && typeof data.preferences === 'object' ? data.preferences : {};
        setPrefs((previous) => {
          const next = { ...previous };
          SYNCABLE_PREF_KEYS.forEach((key) => {
            if (!localPrefKeysRef.current.has(key) && Object.prototype.hasOwnProperty.call(cloudPreferences, key)) next[key] = cloudPreferences[key];
          });
          next.liked = [...new Set([...(previous.liked || []), ...(Array.isArray(cloudPreferences.liked) ? cloudPreferences.liked : [])])];
          return next;
        });
        setUserPlaylists(mergePlaylistList(Array.isArray(data.playlists) ? data.playlists : []));
        await refreshUserPlaylists();
      } catch (error) {
        if (active) setNotice(error.message || 'Unable to load your library.');
      } finally {
        if (active) setLibraryHydrated(true);
      }
    })();
    return () => { active = false; };
  }, [authUid, refreshUserPlaylists]);

  useEffect(() => {
    if (!authUid || !libraryHydrated) return undefined;
    if (!didInitialLibrarySync.current) {
      didInitialLibrarySync.current = true;
      return undefined;
    }

    const timer = setTimeout(async () => {
      const dirtyKeys = [...dirtyPrefKeysRef.current];
      if (!dirtyKeys.length) return;
      try {
        const payload = {
          preferences: {
            theme: prefs.theme,
            accent: prefs.accent,
            customAccent: prefs.customAccent,
            accentIntensity: prefs.accentIntensity,
            waveforms: prefs.waveforms,
            compact: prefs.compact,
            spin: prefs.spin,
            volume: prefs.volume,
            liked: prefs.liked
          }
        };
        const response = await authenticatedJsonRequest(`${apiBase}/me/library`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Unable to sync your library.');
        }
        dirtyKeys.forEach((key) => dirtyPrefKeysRef.current.delete(key));
      } catch (error) {
        setNotice(error.message || 'Unable to sync your library.');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [authUid, libraryHydrated, prefs.theme, prefs.accent, prefs.customAccent, prefs.accentIntensity, prefs.waveforms, prefs.compact, prefs.spin, prefs.volume, prefs.liked]);

  /* ------------------------------ data ------------------------------ */

  /* Loads the catalog. Real songs are cached; sample songs are only shown, and always with the reason why. */
  const fetchCatalog = useCallback(async ({ silent = false } = {}) => {
    catalogRequestRef.current += 1;
    const requestId = catalogRequestRef.current;
    const isCurrent = () => catalogRequestRef.current === requestId;
    const cached = getCachedCatalog();
    let cachedEtag = '';
    try { cachedEtag = window.localStorage.getItem(CATALOG_ETAG_KEY) || ''; } catch {}

    if (API_MISCONFIGURED) {
      // Don't burn a 30s timeout hitting nothing - fail immediately with
      // a message that says exactly what to fix.
      setServerOnline(false);
      setCatalog(cached);
      setCatalogStatus({ state: cached.length ? 'cached' : 'loading', message: describeConfigProblem() });
      return;
    }

    if (!silent) {
      setCatalog((existing) => (existing.length ? existing : cached));
      setCatalogStatus({ state: 'loading', message: '' });
    }

    let lastError = null;
    for (let attempt = 0; attempt <= CATALOG_RETRY_DELAYS.length; attempt += 1) {
      if (attempt > 0) await sleep(CATALOG_RETRY_DELAYS[attempt - 1]);
      if (!isCurrent()) return;
      try {
        const response = await requestWithTimeout(`${apiBase}/catalog`, CATALOG_TIMEOUT_MS, cachedEtag ? { 'If-None-Match': cachedEtag } : {});
        if (response.status === 304) {
          if (cached.length) setCatalog(cached);
          setCatalogStatus({ state: cached.length ? 'cached' : 'loading', message: '' });
          return;
        }
        if (!response.ok) {
          const failure = new Error(`Catalog request failed (${response.status})`);
          failure.status = response.status;
          throw failure;
        }
        const songs = pickSongs(await response.json());
        if (!isCurrent()) return;
        setServerOnline(true);
        if (!songs.length) {
          clearCachedCatalog();
          setCatalog([]);
          setCatalogStatus({
            state: 'loading',
            message: 'The server is reachable, but it has no catalog yet. Waiting for uploads…'
          });
          return;
        }
        setCatalog(songs);
        saveCachedCatalog(songs);
        try {
          const etag = response.headers.get('ETag');
          if (etag) window.localStorage.setItem(CATALOG_ETAG_KEY, etag);
        } catch {}
        setCatalogStatus({ state: 'ready', message: '' });
        return;
      } catch (error) {
        lastError = error;
        if (isAbortError(error)) {
          if (!silent && attempt === 0 && isCurrent()) {
            setCatalog((existing) => (existing.length ? existing : cached.length ? cached : []));
            setCatalogStatus({ state: 'loading', message: 'The server is not answering yet. Retrying…' });
          }
          continue;
        }
        if (error?.status && error.status < 500 && error.status !== 408 && error.status !== 429) break;
        if (!silent && attempt === 0 && isCurrent()) {
          setCatalog((existing) => (existing.length ? existing : cached.length ? cached : []));
          setCatalogStatus({ state: 'loading', message: 'The server is not answering yet. Retrying…' });
        }
      }
    }

    if (!isCurrent()) return;
    if (!isAbortError(lastError)) {
      console.error('Unable to load catalog', lastError);
    }
    setServerOnline(false);
    const reason = isAbortError(lastError)
      ? explainCatalogError(lastError)
      : lastError?.status ? explainCatalogError(lastError) : describeConfigProblem() || explainCatalogError(lastError);
    setCatalog((existing) => (existing.length && !isSampleCatalog(existing) ? existing : cached.length ? cached : []));
    setCatalogStatus({ state: cached.length ? 'cached' : 'loading', message: reason });
  }, []);

  useEffect(() => {
    fetchCatalog();
    return () => {
      catalogRequestRef.current = -1;
    };
  }, [fetchCatalog]);

  const catalogTracks = useMemo(() => catalog.map(normalizeTrack), [catalog]);
  const allTracks = catalogTracks;
  const trackById = useMemo(() => new Map(allTracks.map((track) => [track.id, track])), [allTracks]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadRecommendations = async () => {
      if (API_MISCONFIGURED) return;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const params = new URLSearchParams({ tz: timeZone, deviceId: getDeviceId() });
      try {
        let token = null;
        try {
          token = await Promise.race([
            getCurrentIdToken(),
            new Promise((resolve) => setTimeout(() => resolve(null), 1500))
          ]);
        } catch { token = null; }
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetch(`${apiBase}/recommendations/daily?${params}`, { headers, signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load recommendations.');
        if (!active) return;
        const snapshot = { state: 'ready', dateKey: data.dateKey || '', mixes: Array.isArray(data.mixes) ? data.mixes : [], next: data.next || null };
        setDailyRecommendations(snapshot);
        saveCachedRecommendations(snapshot);
      } catch (error) {
        if (active && error.name !== 'AbortError') setDailyRecommendations((previous) => previous.mixes?.length ? previous : { ...previous, state: 'error' });
      }
    };
    loadRecommendations();
    return () => { active = false; controller.abort(); };
  }, [authUser, recommendationRefresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      setDailyRecommendations((previous) => previous.dateKey !== today && previous.next?.dateKey === today
        ? { ...previous, dateKey: today, mixes: previous.next.mixes, next: null }
        : previous);
    }, 300000);
    return () => clearInterval(timer);
  }, []);

  const recommendedMixes = useMemo(() => dailyRecommendations.mixes.map((mix) => ({
    ...mix,
    tracks: (mix.trackIds || []).map((id) => trackById.get(String(id))).filter(Boolean)
  })), [dailyRecommendations.mixes, trackById]);
  const savedMixesWithTracks = useMemo(() => savedMixes.map((mix) => ({
    ...mix,
    tracks: (mix.trackIds || []).map((id) => trackById.get(String(id))).filter(Boolean)
  })), [savedMixes, trackById]);

  const recentUploads = useMemo(() => {
    const seen = new Set();
    return [...sessionUploads, ...catalogTracks].filter((track) => (seen.has(track.id) ? false : seen.add(track.id))).slice(0, 5);
  }, [sessionUploads, catalogTracks]);

  const userUploadPlaylists = useMemo(() => {
    const map = new Map();
    for (const track of catalogTracks) {
      if (track.uploadedByName || track.uploadedByEmail || track.source === 'upload') {
        const uploaderName = track.uploadedByName || (track.uploadedByEmail ? track.uploadedByEmail.split('@')[0] : 'Community');
        const id = `user-upload-${uploaderName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        if (!map.has(id)) {
          map.set(id, {
            id,
            name: `${uploaderName}'s Uploads`,
            description: `Cloud music uploaded by ${uploaderName}`,
            trackIds: [],
            tracks: []
          });
        }
        map.get(id).tracks.push(track);
        map.get(id).trackIds.push(track.id);
      }
    }
    return Array.from(map.values());
  }, [catalogTracks]);

  const playlists = useMemo(
    () =>
      [...defaultPlaylists, ...userUploadPlaylists, ...userPlaylists.filter((playlist) => playlist.id !== 'uploads')].map((playlist) => ({
        ...playlist,
        tracks: playlist.tracks || (playlist.dynamic === 'uploads' ? catalogTracks : playlist.trackIds?.map((id) => trackById.get(id)).filter(Boolean) || [])
      })),
    [catalogTracks, trackById, userPlaylists, userUploadPlaylists]
  );
  const selectedPlaylist = playlists.find((playlist) => playlist.id === playlistId) || playlists[0] || null;
  const favoriteTracks = useMemo(() => allTracks.filter((track) => likedIds.has(track.id)), [allTracks, likedIds]);
  const recentlyAddedTracks = useMemo(() => [...allTracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 6), [allTracks]);
  const dailyMix = useMemo(() => buildDailyMix({
    catalog: allTracks,
    userId: authUser?.uid || authUser?.email || 'guest',
    dateKey: new Date().toISOString().slice(0, 10),
    limit: 5
  }), [allTracks, authUser]);
  const [featuredTrack, setFeaturedTrack] = useState(null);
  const featuredPickCatalogRef = useRef('');
  const recentHistoryTracks = useMemo(
    () => playHistory.map((entry) => trackById.get(entry.trackId)).filter(Boolean),
    [playHistory, trackById]
  );
  const recentPlayedIds = useMemo(() => recentHistoryTracks.slice(0, 15).map((track) => track.id), [recentHistoryTracks]);

  useEffect(() => {
    saveFeaturedHistory(featuredHistory);
  }, [featuredHistory]);

  useEffect(() => {
    const timer = setTimeout(() => savePlayHistory(playHistory), 5000);
    const flush = () => savePlayHistory(playHistory);
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [playHistory]);

  useEffect(() => {
    const playable = allTracks.filter((track) => track?.audioUrl);
    if (!playable.length) {
      setFeaturedTrack(null);
      featuredPickCatalogRef.current = '';
      return;
    }
    if (featuredTrack && playable.some((track) => track.id === featuredTrack.id)) return;
    const catalogSignature = playable.map((track) => track.id).join('|');
    if (featuredPickCatalogRef.current === catalogSignature) return;
    const next = pickRandomFeaturedTrack({
      catalog: playable,
      recentIds: featuredHistory,
      recentlyPlayedIds: recentPlayedIds
    });
    if (!next) return;
    featuredPickCatalogRef.current = catalogSignature;
    setFeaturedTrack(next);
    setFeaturedHistory((previous) => [...previous.filter((id) => id !== next.id), next.id].slice(-10));
  }, [allTracks, featuredHistory, featuredTrack, recentPlayedIds]);

  const visibleTracks = useMemo(() => {
    const search = query.trim().toLowerCase();
    const list = search ? allTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(search)) : [...allTracks];
    const compare = { sensitivity: 'base' };
    const sorters = {
      name: (a, b) => a.title.localeCompare(b.title, undefined, compare),
      artist: (a, b) => a.artist.localeCompare(b.artist, undefined, compare) || a.title.localeCompare(b.title, undefined, compare),
      added: (a, b) => b.addedAt - a.addedAt,
      duration: (a, b) => b.seconds - a.seconds
    };
    return list.sort(sorters[sortKey]);
  }, [allTracks, query, sortKey]);

  const albums = useMemo(() => groupBy(allTracks, (track) => [track.album]), [allTracks]);
  const artists = useMemo(() => groupBy(allTracks, (track) => track.artist.split(/\s*,\s*/).filter(Boolean)), [allTracks]);
  const libraryTracks = useMemo(() => [...allTracks].sort((a, b) => b.addedAt - a.addedAt), [allTracks]);

  /* ------------------------------ theme ------------------------------ */

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    const option = accentOptions.find((item) => item.id === prefs.accent);
    const color = prefs.accent === 'custom' ? prefs.customAccent : (option || accentOptions[0])[resolvedTheme];
    const palette = buildAccentPalette(color, resolvedTheme, prefs.accentIntensity);
    root.dataset.intensity = prefs.accentIntensity;
    root.style.setProperty('--accent', palette.accent);
    root.style.setProperty('--accent-strong', palette.accentStrong);
    root.style.setProperty('--accent-soft', palette.accentSoft);
    root.style.setProperty('--on-accent', palette.onAccent);
    root.style.setProperty('--tint-bg', palette.tintBg);
    root.style.setProperty('--tint-paper', palette.tintPaper);
    root.style.setProperty('--tint-raised', palette.tintRaised);
    root.style.setProperty('--tint-line', palette.tintLine);
    root.style.setProperty('--line-soft', palette.tintLineSoft);
    root.style.setProperty('--bg', palette.tintBg);
    root.style.setProperty('--paper', palette.tintPaper);
    root.style.setProperty('--raised', palette.tintRaised);
    root.style.setProperty('--line', palette.tintLine);
    palette.tones.forEach((tone, index) => root.style.setProperty(`--tone-${index + 1}`, tone));
    palette.toneForegrounds.forEach((tone, index) => root.style.setProperty(`--tone-${index + 1}-fg`, tone));
  }, [resolvedTheme, prefs.accent, prefs.customAccent, prefs.accentIntensity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);

  useEffect(() => {
    const themeMeta = document.querySelector('meta[name="theme-color"]') || document.createElement('meta');
    themeMeta.name = 'theme-color';
    themeMeta.setAttribute('content', prefs.accent === 'custom' ? prefs.customAccent : accentOptions.find((item) => item.id === prefs.accent)?.[resolvedTheme] || accentOptions[0][resolvedTheme]);
    if (!themeMeta.parentNode) document.head.appendChild(themeMeta);
  }, [prefs.accent, prefs.customAccent, resolvedTheme]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, libraryTab, playlistId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ------------------------------ playback ------------------------------ */

  const seekTo = (value) => {
    setPosition(value);
    const audio = audioRef.current;
    if (audio && current?.src) audio.currentTime = value;
  };

  const restart = () => {
    setPosition(0);
    const audio = audioRef.current;
    if (audio && current?.src) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    setIsPlaying(true);
  };

  const startPlayback = (list, index, label, shuffleOverride) => {
    if (!list.length) return;
    const useShuffle = typeof shuffleOverride === 'boolean' ? shuffleOverride : shuffle;
    const startIndex = Math.min(Math.max(index, 0), list.length - 1);
    const first = list[startIndex];
    if (audioRef.current && first.src && first.id === current?.id) audioRef.current.currentTime = 0;

    setShuffle(useShuffle);
    setDjOn(false);
    setQueueBase(list);
    setContextLabel(label);
    if (useShuffle) {
      setQueue([first, ...shuffled(list.filter((_, itemIndex) => itemIndex !== startIndex))]);
      setPos(0);
    } else {
      setQueue(list);
      setPos(startIndex);
    }
    setPosition(0);
    setIsPlaying(true);
  };

  const recordPlaybackProgress = (track, currentTime, duration, ended = false) => {
    if (!track?.id) return;
    const progress = playProgressRef.current;
    const shortTrackEnded = ended && duration > 0 && duration < 20 && currentTime >= duration - 0.25;
    if (!progress.qualified && qualifiesForPlayHistory({ listenedSeconds: progress.listenedSeconds, currentTime, duration: shortTrackEnded ? duration : 0 })) {
      progress.qualified = true;
      setPlayHistory((previous) => updatePlayHistory({ history: previous, trackId: track.id, at: Date.now() }));
    }
  };

  const handleAudioTimeUpdate = (event) => {
    const audio = event.currentTarget;
    setPosition(audio.currentTime);
    if (!current?.id || !isPlaying) return;
    const progress = playProgressRef.current;
    if (progress.trackId !== current.id) {
      progress.trackId = current.id;
      progress.lastTime = audio.currentTime;
      progress.listenedSeconds = 0;
      progress.qualified = false;
      return;
    }
    const delta = audio.currentTime - progress.lastTime;
    progress.lastTime = audio.currentTime;
    if (delta > 0 && delta <= 1.5) progress.listenedSeconds += delta;
    recordPlaybackProgress(current, audio.currentTime, audio.duration || current.seconds || 0);
  };

  const playFromList = (list, index, label) => {
    const target = list[index];
    if (!target) return;
    if (current && target.id === current.id) {
      setIsPlaying((playing) => !playing);
      return;
    }
    startPlayback(list, index, label);
  };

  const togglePlay = () => {
    if (current) setIsPlaying((playing) => !playing);
  };

  const advance = (auto = false) => {
    if (!queue.length) return;
    if (auto && repeat === 'one') {
      restart();
      return;
    }

    let next = pos + 1;
    if (next >= queue.length) {
      if (djOn) {
        const recent = queue.slice(-3).map((track) => track.id);
        const more = shuffled(allTracks.filter((track) => !recent.includes(track.id)));
        if (more.length) {
          setQueue([...queue, ...more]);
          setPos(next);
          setPosition(0);
          return;
        }
      }
      if (repeat === 'all') {
        next = 0;
      } else {
        setIsPlaying(false);
        seekTo(0);
        return;
      }
    }

    if (next === pos) {
      restart();
      return;
    }
    setPos(next);
    setPosition(0);
  };

  const previous = () => {
    if (!queue.length) return;
    if (position > 3 || (pos <= 0 && repeat !== 'all')) {
      seekTo(0);
      return;
    }
    setPos(pos <= 0 ? queue.length - 1 : pos - 1);
    setPosition(0);
  };

  const jumpTo = (index) => {
    setPos(index);
    setPosition(0);
    setIsPlaying(true);
  };

  const toggleShuffle = () => {
    if (!queue.length) return;
    if (!shuffle) {
      setQueue([queue[pos], ...shuffled(queue.filter((_, index) => index !== pos))]);
      setPos(0);
      setShuffle(true);
      return;
    }
    const base = queueBase.length ? queueBase : queue;
    const index = base.findIndex((track) => track.id === current?.id);
    setQueue(base);
    setPos(index >= 0 ? index : 0);
    setShuffle(false);
    setDjOn(false);
  };

  const cycleRepeat = () => setRepeat((mode) => (mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'));

  const toggleDj = () => {
    if (djOn) {
      setDjOn(false);
      setNotice('DJ stopped. Your queue stays as it is.');
      return;
    }

    const first = (isPlaying && current) || featuredTrack || pickRandomFeaturedTrack({
      catalog: allTracks,
      recentIds: featuredHistory,
      recentlyPlayedIds: recentPlayedIds
    }) || allTracks.find((track) => track.audioUrl);
    if (!first) return;

    setFeaturedHistory((previous) => [...previous.filter((id) => id !== first.id), first.id].slice(-6));
    setQueue([first, ...shuffled(allTracks.filter((track) => track.id !== first.id))]);
    setQueueBase(allTracks);
    setPos(0);
    if (first.id !== current?.id) setPosition(0);
    setContextLabel('Sonara DJ');
    setShuffle(true);
    setRepeat('off');
    setDjOn(true);
    setIsPlaying(true);
    setNotice(`DJ is on. Starting with ${first.title}.`);
  };

  advanceRef.current = advance;
  controlsRef.current = { togglePlay, next: () => advance(false), previous };

  /* audio element wiring */
  useEffect(() => {
    const audio = audioRef.current;
    setAudioDuration(0);
    if (!audio) return;
    audio.pause();
    if (current?.src && audioSourceRef.current !== current.src) {
      audio.preload = 'auto';
      audio.src = current.src;
      audioSourceRef.current = current.src;
      audio.load();
    } else if (!current?.src && audioSourceRef.current) {
      audio.removeAttribute('src');
      audioSourceRef.current = '';
      audio.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.src) return;
    if (isPlaying) {
      const attempt = audio.play();
      if (attempt?.catch) {
        attempt.catch((error) => {
          if (error?.name === 'AbortError') return;
          setIsPlaying(false);
          setNotice('This file could not be played.');
        });
      }
    } else {
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, current?.id]);

  useEffect(() => {
    const nextTrack = queue[pos + 1];
    if (!nextTrack?.src || nextTrack.src === current?.src) return undefined;
    const prefetch = new Audio();
    prefetch.preload = 'auto';
    prefetch.src = nextTrack.src;
    prefetch.load();
    nextAudioRef.current = prefetch;
    return () => {
      prefetch.pause();
      prefetch.removeAttribute('src');
      if (nextAudioRef.current === prefetch) nextAudioRef.current = null;
    };
  }, [queue, pos, current?.src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : prefs.volume;
  }, [muted, prefs.volume]);

  /* keyboard + media keys */
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (event.code !== 'Space' || event.repeat || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
      event.preventDefault();
      controlsRef.current.togglePlay?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !current || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: current.album });
    navigator.mediaSession.setActionHandler('play', () => controlsRef.current.togglePlay?.());
    navigator.mediaSession.setActionHandler('pause', () => controlsRef.current.togglePlay?.());
    navigator.mediaSession.setActionHandler('nexttrack', () => controlsRef.current.next?.());
    navigator.mediaSession.setActionHandler('previoustrack', () => controlsRef.current.previous?.());
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ upload ------------------------------ */

  const updateSelection = (incoming) => {
    const files = Array.from(incoming || []).filter(Boolean);
    const audioFiles = files.filter(isAudioFile);
    setUploadQueue((previous) => (previous && previous.status !== 'running' ? null : previous));
    if (!audioFiles.length) {
      setSelectedFiles([]);
      setUploadMessage({ tone: 'error', text: files.length ? 'No supported audio files were found in that selection.' : 'Nothing was selected.' });
      return;
    }
    const skipped = files.length - audioFiles.length;
    setSelectedFiles(audioFiles);
    setUploadMessage({ tone: 'info', text: `${plural(audioFiles.length, 'track')} ready to upload${skipped ? ` (${plural(skipped, 'other file')} skipped)` : ''}.` });
  };

  const handleInputChange = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length) updateSelection(files);
  };

  const openPicker = () => (uploadMode === 'folder' ? folderInputRef : filesInputRef).current?.click();

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const transfer = event.dataTransfer;
    const entries = Array.from(transfer?.items || [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    const fallback = Array.from(transfer?.files || []);
    if (entries.length) {
      Promise.all(entries.map(readEntry)).then((nested) => updateSelection(nested.flat()));
    } else {
      updateSelection(fallback);
    }
  };

  const handleUpload = async () => {
    if (isUploading) return;
    if (!selectedFiles.length) {
      setUploadMessage({ tone: 'error', text: 'Choose audio files or a folder before uploading.' });
      return;
    }

    const files = [...selectedFiles];
    const groups = [];
    for (let start = 0; start < files.length; start += batchSize) groups.push(files.slice(start, start + batchSize));

    const run = { cancelled: false, abort: null };
    uploadRunRef.current = run;
    const succeeded = new Set();
    let done = 0;
    let failed = 0;
    let streak = 0;
    let lastError = '';

    setUploadMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setUploadQueue({
      status: 'running',
      total: files.length,
      done: 0,
      failed: 0,
      batch: 1,
      batches: groups.length,
      batchProgress: 0,
      current: groups[0].map((file) => file.name),
      currentSize: groups[0].length,
      groups: groups.map(() => 'pending'),
      startedAt: Date.now(),
      cancelling: false,
      error: '',
      remaining: files.length
    });

    for (let index = 0; index < groups.length && !run.cancelled; index += 1) {
      const group = groups[index];
      setUploadQueue((previous) => ({
        ...previous,
        batch: index + 1,
        batchProgress: 0,
        current: group.map((file) => file.name),
        currentSize: group.length
      }));

      let ok = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok && !run.cancelled; attempt += 1) {
        try {
          const formData = new FormData();
          group.forEach((file) => formData.append('files', file, file.webkitRelativePath || file.name));
          let token;
          try {
            token = await getCurrentIdToken();
          } catch {
            token = undefined;
          }
          const data = await sendUpload(
            formData,
            (fraction) => setUploadQueue((previous) => (previous ? { ...previous, batchProgress: fraction } : previous)),
            run,
            token
          );
          const uploaded = (Array.isArray(data?.tracks) ? data.tracks : []).map(normalizeTrack);
          if (uploaded.length) setSessionUploads((previous) => [...uploaded, ...previous].slice(0, 50));
          ok = true;
        } catch (error) {
          lastError = error.message || 'Upload failed.';
        }
      }

      if (run.cancelled) break;

      if (ok) {
        succeeded.add(index);
        done += group.length;
        streak = 0;
        setUploadQueue((previous) => ({ ...previous, done, batchProgress: 0, groups: previous.groups.map((state, groupIndex) => (groupIndex === index ? 'done' : state)) }));
      } else {
        failed += group.length;
        streak += 1;
        setUploadQueue((previous) => ({ ...previous, failed, batchProgress: 0, groups: previous.groups.map((state, groupIndex) => (groupIndex === index ? 'failed' : state)) }));
        if (streak >= MAX_CONSECUTIVE_FAILURES) break;
      }
    }

    const remaining = groups.flatMap((group, index) => (succeeded.has(index) ? [] : group));
    const status = run.cancelled ? 'cancelled' : streak >= MAX_CONSECUTIVE_FAILURES ? 'stopped' : failed ? 'partial' : 'done';
    setSelectedFiles(remaining);
    setUploadQueue((previous) => ({
      ...previous,
      status,
      done,
      failed,
      current: [],
      batchProgress: 0,
      cancelling: false,
      error: lastError,
      remaining: remaining.length
    }));
    fetchCatalog({ silent: true });
  };

  const cancelUpload = () => {
    const run = uploadRunRef.current;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    if (run.abort) run.abort();
    setUploadQueue((previous) => (previous ? { ...previous, cancelling: true } : previous));
  };

  /* Warn before closing the tab while an upload is still running. */
  useEffect(() => {
    if (!isUploading) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isUploading]);

  /* ------------------------------ navigation ------------------------------ */

  const goTo = (id) => {
    if (protectedViews.has(id) && !authUser) {
      setAuthReason(`Sign in to access ${pageMeta[id]?.title || 'this feature'}.`);
      setAuthOpen(true);
      return;
    }
    setView(id);
    setStageOpen(false);
  };

  const openPlaylist = (id) => {
    setPlaylistId(id);
    goTo('playlists');
  };

  const handleSearch = (value) => {
    setQuery(value);
    if (view !== 'all-music') goTo('all-music');
  };

  const searchFor = (value) => {
    setQuery(value);
    goTo('all-music');
  };

  const upNext = queue.slice(pos + 1, pos + 6).map((track, offset) => ({ track, index: pos + 1 + offset }));
  const tableProps = {
    currentId: current?.id,
    isPlaying,
    likedIds,
    onToggleLike: toggleLike,
    showWaveform: prefs.waveforms
  };
  const collectionItems = useMemo(() => [
    { id: 'favorites', name: 'Favorites', kind: 'playlists', tracks: favoriteTracks, open: () => goTo('favorites') },
    ...playlists.map((playlist) => ({ id: playlist.id, name: playlist.name, kind: playlist.dynamic ? 'uploads' : 'playlists', tracks: playlist.tracks, open: () => openPlaylist(playlist.id) })),
    ...savedMixesWithTracks.map((mix) => ({ id: mix.id, name: mix.name, kind: 'mixes', tracks: mix.tracks, open: () => startPlayback(mix.tracks, 0, mix.name) }))
  ], [favoriteTracks, playlists, savedMixesWithTracks]);

  const mixGridRef = useRef(null);
  const collectionRef = useRef(null);
  const recentRef = useRef(null);
  const mixFit = useMixGridFit(mixGridRef, Math.max(0, Math.min(recommendedMixes.length, 12)));
  const collectionVisibleCount = useVisibleCount(collectionRef, collectionItems || [], 8);
  const recentVisibleCount = recentHistoryTracks.length || 0;

  /* ------------------------------ views ------------------------------ */

  const renderHome = () => {
    const collectionItems = [
      { id: 'favorites', name: 'Favorites', kind: 'Playlist', tracks: favoriteTracks, open: () => goTo('favorites') },
      ...playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        kind: playlist.dynamic ? 'Uploads' : 'Playlist',
        tracks: playlist.tracks,
        open: () => openPlaylist(playlist.id)
      })),
      ...savedMixesWithTracks.map((mix) => ({
        id: mix.id,
        name: mix.name,
        kind: 'Mixes',
        tracks: mix.tracks,
        open: () => startPlayback(mix.tracks, 0, mix.name)
      }))
    ];
    const filteredCollection = collectionItems.filter((item) => collectionFilter === 'all' || item.kind.toLowerCase() === collectionFilter);
    const spotlightTrack = featuredTrack || current || recentHistoryTracks[0] || favoriteTracks[0] || allTracks.find((track) => track.audioUrl);
    const spotlightPlaying = Boolean(spotlightTrack && isPlaying && current?.id === spotlightTrack.id);
    const playSpotlight = () => {
      if (!spotlightTrack) return;
      if (current && current.id === spotlightTrack.id) {
        togglePlay();
        return;
      }
      const index = allTracks.findIndex((item) => item.id === spotlightTrack.id);
      if (index >= 0) startPlayback(allTracks, index, 'All Music');
    };
    const randomizeFeatured = () => {
      const next = pickRandomFeaturedTrack({
        catalog: allTracks,
        recentIds: featuredHistory,
        lastFeaturedIds: featuredHistory.slice(-2)
      });
      if (!next) return;
      setFeaturedHistory((previous) => [...previous.filter((id) => id !== next.id), next.id].slice(-6));
      setNotice(`Fresh pick: ${next.title} by ${next.artist}.`);
    };
    const playRecent = (track) => playFromList(allTracks, allTracks.findIndex((item) => item.id === track.id), 'Recently played');
    const recentLead = recentHistoryTracks[0] || allTracks[0];
    const recentList = recentHistoryTracks.slice(0, 4).length ? recentHistoryTracks.slice(0, 4) : allTracks.slice(0, 4);

    return (
      <>
        <section className="hero">
          <div className="hero-head">
            <p className="greeting">
              <i className="live-dot" aria-hidden="true" />
              {greeting()}, {getUserDisplayName(authUser)}
            </p>
          </div>

          <div className="hero-grid">
            <div className="feature-panel" style={{ '--tint': tint.bg, '--tint-fg': tint.fg }}>
              <div className="feature-art">
                <SleeveStack track={spotlightTrack} playing={isPlaying} spin={prefs.spin} onClick={() => setStageOpen(true)} />
              </div>
              <div className="feature-side">
                {spotlightTrack && (
                  <div className="feature-meta">
                    <span className="feature-kicker">{spotlightPlaying ? 'Now spinning' : 'Ready on the deck'}</span>
                    <strong>{spotlightTrack.title}</strong>
                    <small>{spotlightTrack.artist}</small>
                  </div>
                )}
                <div className="feature-actions">
                  <button type="button" className="feature-play" onClick={playSpotlight} aria-label={spotlightPlaying ? 'Pause' : 'Play'} disabled={!spotlightTrack}>
                    <Icon name={spotlightPlaying ? 'pause' : 'play'} size={20} />
                  </button>
                  <DjButton active={djOn} onClick={toggleDj} className="feature-dj" />
                </div>
              </div>
            </div>

            <div className="mini-feature-card">
              <div className="mini-feature-header">
                <span>Recently played</span>
                <button type="button" className="text-btn" onClick={() => goTo('all-music')}>View all</button>
              </div>
              {recentLead && (
                <button type="button" className="mini-feature-spotlight" onClick={() => playRecent(recentLead)} aria-label={`Play ${recentLead.title}`}>
                  <CoverArt track={recentLead} size="lg" />
                </button>
              )}
              <div className="mini-feature-grid">
                {recentList.map((track) => (
                  <button key={track.id} type="button" className="mini-feature-tile" onClick={() => playRecent(track)}>
                    <CoverArt track={track} size="sm" />
                    <span>
                      <strong>{track.title}</strong>
                      <small>{formatTime(track.seconds)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="block">
          <SectionHead title="Soundscapes" note="Curated vibes for your mood" />
          <div className="scape-grid">
            {scapes.map((scape, index) => {
              const tone = SCAPE_TONES[index % SCAPE_TONES.length];
              return (
                <div key={scape.id} className="scape" style={{ '--tone-bg': tone.bg, '--tone-fg': tone.fg }}>
                  <button type="button" className="scape-body" onClick={scape.open}>
                    <span className="scape-kind">{scape.kind}</span>
                    <span className="scape-name">{scape.name}</span>
                    <span className="scape-count">{plural(scape.tracks.length, 'track')}</span>
                  </button>
                  <button type="button" className="scape-play" disabled={!scape.tracks.length} onClick={() => startPlayback(scape.tracks, 0, scape.name)} aria-label={`Play ${scape.name}`}>
                    <Icon name="play" size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="block">
          <SectionHead title="Daily recommended mix" note="A fresh handpicked stack for today" action={<button type="button" className="text-btn" onClick={() => randomizeFeatured()}>Refresh</button>} />
          <div className="sleeve-grid">
            {dailyMix.map((track, index) => (
              <div key={`${track.id}-${index}`} className="tile">
                <button type="button" className="tile-hit" onClick={() => startPlayback(dailyMix, index, 'Daily recommended mix')}>
                  <span className="tile-art">
                    <span className="peek">
                      <Record track={track} />
                    </span>
                    <CoverArt track={track} size="fill" />
                    <span className="tile-play">
                      <Icon name={current?.id === track.id && isPlaying ? 'pause' : 'play'} size={18} />
                    </span>
                  </span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="block">
          <SectionHead title="Jump back in" note="Recently added to your library" action={<button type="button" className="text-btn" onClick={() => goTo('all-music')}>See everything</button>} />
          <div className="sleeve-grid">
            {recentHistoryTracks.map((track, index) => (
              <div key={track.id} className="tile">
                <button type="button" className="tile-hit" onClick={() => playFromList(recentHistoryTracks, index, 'Recently played')}>
                  <span className="tile-art">
                    <span className="peek">
                      <Record track={track} />
                    </span>
                    <CoverArt track={track} size="fill" />
                    <span className="tile-play">
                      <Icon name={current?.id === track.id && isPlaying ? 'pause' : 'play'} size={18} />
                    </span>
                  </span>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </button>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  };

  const renderAllMusic = () => (
    <>
      <div className="sortbar">
        <span>Sort by</span>
        {sortOptions.map((option) => (
          <button key={option.id} type="button" className={`sort-link ${sortKey === option.id ? 'is-active' : ''}`} aria-pressed={sortKey === option.id} onClick={() => setSortKey(option.id)}>
            {option.label}
          </button>
        ))}
        {query && (
          <button type="button" className="text-btn sortbar-clear" onClick={() => setQuery('')}>
            Clear search for “{query}”
          </button>
        )}
      </div>
      {visibleTracks.length ? (
        <Tracklist
          tracks={visibleTracks}
          {...tableProps}
          onPlay={(index) => playFromList(visibleTracks, index, query ? `Search: ${query}` : 'All Music')}
          onAddToPlaylist={(track) => setPlaylistMenuTrack(track)}
        />
      ) : (
        <EmptyState icon="search" title="No matches" text={`Nothing in your library matches “${query}”.`} action={<button type="button" className="btn" onClick={() => setQuery('')}>Clear search</button>} />
      )}
    </>
  );

  const renderLibrary = () => (
    <>
      <div className="tabs" role="tablist" aria-label="Library sections">
        {[
          ['songs', 'Songs'],
          ['albums', 'Albums'],
          ['artists', 'Artists'],
          ['playlists', 'Playlists']
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={libraryTab === id} className={`tab-link ${libraryTab === id ? 'is-active' : ''}`} onClick={() => setLibraryTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {libraryTab === 'songs' && (
        <Tracklist
          tracks={libraryTracks}
          {...tableProps}
          onPlay={(index) => playFromList(libraryTracks, index, 'Library')}
          onAddToPlaylist={(track) => setPlaylistMenuTrack(track)}
        />
      )}

      {libraryTab === 'albums' && (
        <div className="sleeve-grid">
          {albums.map((album) => (
            <div key={album.name} className="tile">
              <button type="button" className="tile-hit" onClick={() => searchFor(album.name)}>
                <span className="tile-art">
                  <span className="peek">
                    <Record track={album.items[0]} />
                  </span>
                  <CoverArt track={{ id: album.name }} size="fill" />
                </span>
                <strong>{album.name}</strong>
                <small>{plural(album.items.length, 'track')}</small>
              </button>
              <button type="button" className="tile-fab" onClick={() => startPlayback(album.items, 0, album.name)} aria-label={`Play ${album.name}`}>
                <Icon name="play" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {libraryTab === 'artists' && (
        <div className="artist-grid">
          {artists.map((artist) => (
            <div key={artist.name} className="artist-card">
              <button type="button" className="artist-hit" onClick={() => searchFor(artist.name)}>
                <CoverArt track={{ id: artist.name }} size="fill" round />
                <strong>{artist.name}</strong>
                <small>{plural(artist.items.length, 'track')}</small>
              </button>
              <button type="button" className="tile-fab is-round" onClick={() => startPlayback(artist.items, 0, artist.name)} aria-label={`Play ${artist.name}`}>
                <Icon name="play" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {libraryTab === 'playlists' && (
        <div className="list-stack">
          {[{ id: 'favorites', name: 'Favorites', description: 'Songs you have hearted', tracks: favoriteTracks }, ...playlists].map((playlist) => (
            <button key={playlist.id} type="button" className="list-card" onClick={() => (playlist.id === 'favorites' ? goTo('favorites') : openPlaylist(playlist.id))}>
              <span className="list-card-art">
                <CoverArt track={{ id: playlist.id }} size="sm" />
              </span>
              <span className="list-card-text">
                <strong>{playlist.name}</strong>
                <small>{playlist.description}</small>
              </span>
              <em>{plural(playlist.tracks.length, 'track')}</em>
            </button>
          ))}
        </div>
      )}
    </>
  );

  const renderPlaylists = () => {
    if (!selectedPlaylist) {
      return (
        <EmptyState icon="list" title="No playlists yet" text="Create your first playlist to start collecting favorites and mood-based mixes." action={<button type="button" className="btn" onClick={() => setPlaylistComposer({ mode: 'create', playlistId: null, name: '' })}>New playlist</button>} />
      );
    }

    const isUserPlaylist = !selectedPlaylist.dynamic && !defaultPlaylists.some((item) => item.id === selectedPlaylist.id);

    return (
      <div className="pl-layout">
        <nav className="pl-menu" aria-label="Choose a playlist">
          {playlists.map((playlist) => (
            <button key={playlist.id} type="button" className={`pl-item ${playlist.id === selectedPlaylist.id ? 'is-active' : ''}`} aria-current={playlist.id === selectedPlaylist.id ? 'true' : undefined} onClick={() => setPlaylistId(playlist.id)}>
              <span>{playlist.name}</span>
              <sup>{playlist.tracks.length}</sup>
            </button>
          ))}
        </nav>

        <section className="pl-main">
          <div className="pl-head">
            <div className="pl-cover">
              <SleeveStack track={{ id: selectedPlaylist.id }} playing={false} spin={false} />
            </div>
            <div className="pl-info">
              <h2>{selectedPlaylist.name}</h2>
              <p>{selectedPlaylist.description}</p>
              <small>
                {plural(selectedPlaylist.tracks.length, 'track')}
                {selectedPlaylist.tracks.length ? `, ${totalRuntime(selectedPlaylist.tracks)}` : ''}
              </small>
              <div className="pl-actions">
                <button type="button" className="btn btn-primary" disabled={!selectedPlaylist.tracks.length} onClick={() => startPlayback(selectedPlaylist.tracks, 0, selectedPlaylist.name, false)}>
                  <Icon name="play" size={16} /> Play
                </button>
                <button type="button" className="btn" disabled={!selectedPlaylist.tracks.length} onClick={() => startPlayback(selectedPlaylist.tracks, Math.floor(Math.random() * selectedPlaylist.tracks.length), selectedPlaylist.name, true)}>
                  <Icon name="shuffle" size={16} /> Shuffle
                </button>
                {isUserPlaylist && (
                  <>
                    <button type="button" className="btn" onClick={() => { setPlaylistDraft(selectedPlaylist.name); setPlaylistComposer({ mode: 'rename', playlistId: selectedPlaylist.id, name: selectedPlaylist.name }); }}>
                      <Icon name="plus" size={16} /> Rename
                    </button>
                    <button type="button" className="btn btn-cancel" onClick={() => handleDeletePlaylist(selectedPlaylist.id)}>
                      <Icon name="x" size={16} /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {selectedPlaylist.tracks.length ? (
            <Tracklist
              tracks={selectedPlaylist.tracks}
              {...tableProps}
              onPlay={(index) => playFromList(selectedPlaylist.tracks, index, selectedPlaylist.name)}
              onAddToPlaylist={(track) => setPlaylistMenuTrack(track)}
              onRemoveFromPlaylist={(trackId) => handleRemoveTrackFromPlaylist(selectedPlaylist.id, trackId)}
            />
          ) : (
            <EmptyState icon="upload" title="No tracks yet" text="Add songs from your library to build this playlist." action={<button type="button" className="btn" onClick={() => goTo('all-music')}>Browse all music</button>} />
          )}
        </section>
      </div>
    );
  }; 

  const renderFavorites = () =>
    favoriteTracks.length ? (
      <>
        <div className="toolbar">
          <button type="button" className="btn btn-primary" onClick={() => startPlayback(favoriteTracks, 0, 'Favorites', false)}>
            <Icon name="play" size={16} /> Play all
          </button>
          <button type="button" className="btn" onClick={() => startPlayback(favoriteTracks, Math.floor(Math.random() * favoriteTracks.length), 'Favorites', true)}>
            <Icon name="shuffle" size={16} /> Shuffle
          </button>
        </div>
        <Tracklist
          tracks={favoriteTracks}
          {...tableProps}
          onPlay={(index) => playFromList(favoriteTracks, index, 'Favorites')}
          onAddToPlaylist={(track) => setPlaylistMenuTrack(track)}
        />
      </>
    ) : (
      <EmptyState icon="heart" title="No favorites yet" text="Tap the heart on any track and it will show up here." action={<button type="button" className="btn" onClick={() => goTo('all-music')}>Browse all music</button>} />
    );

  const renderUpload = () => (
    <div className="upload-layout">
      <div className="upload-main">
        {uploadQueue && <UploadQueue queue={uploadQueue} onCancel={cancelUpload} onDismiss={() => setUploadQueue(null)} />}

        {!isUploading && (
          <>
            <div className="tabs is-small" role="tablist" aria-label="Upload source">
              {[
                ['files', 'Files'],
                ['folder', 'Folder']
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={uploadMode === id} className={`tab-link ${uploadMode === id ? 'is-active' : ''}`} onClick={() => setUploadMode(id)}>
                  {label}
                </button>
              ))}
            </div>

            <div
              className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={openPicker}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPicker();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input ref={filesInputRef} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.m4b,.m4r" multiple hidden onChange={handleInputChange} />
              <input
                ref={(node) => {
                  folderInputRef.current = node;
                  if (node) {
                    node.setAttribute('webkitdirectory', '');
                    node.setAttribute('directory', '');
                  }
                }}
                type="file"
                multiple
                hidden
                onChange={handleInputChange}
              />
              <span className="drop-record">
                <Record playing={isDragging} spin />
              </span>
              <strong>Drop your music here</strong>
              <span>{uploadMode === 'folder' ? 'or click to choose a folder' : 'or click to choose files'}</span>
              <small>MP3, M4A, FLAC, WAV, OGG. Dropping a folder works too.</small>
            </div>

            <div className="batch-row">
              <span>Upload in groups of</span>
              <div className="chips" role="group" aria-label="Group size">
                {BATCH_OPTIONS.map((size) => (
                  <button key={size} type="button" className={`chip ${batchSize === size ? 'is-active' : ''}`} aria-pressed={batchSize === size} onClick={() => setBatchSize(size)}>
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {selectedFiles.length > 0 && (
              <div className="file-list">
                <div className="file-list-head">
                  <div>
                    <strong>
                      {formatCount(selectedFiles.length)} {selectedFiles.length === 1 ? 'track' : 'tracks'} selected
                    </strong>
                    <span className="file-meta">
                      {formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))}
                      {selectedFiles.length > batchSize ? ` · ${formatCount(Math.ceil(selectedFiles.length / batchSize))} groups of ${batchSize}` : ''}
                    </span>
                  </div>
                  <button type="button" className="text-btn" onClick={() => setSelectedFiles([])}>
                    Clear
                  </button>
                </div>
                <ul>
                  {selectedFiles.slice(0, 6).map((file, index) => (
                    <li key={`${file.webkitRelativePath || file.name}-${index}`}>
                      <Icon name="music" size={16} />
                      <span>{file.name}</span>
                      <em>{formatBytes(file.size)}</em>
                    </li>
                  ))}
                </ul>
                {selectedFiles.length > 6 && <p className="file-more">and {formatCount(selectedFiles.length - 6)} more</p>}
              </div>
            )}

            {uploadMessage && (
              <div className={`notice-box is-${uploadMessage.tone}`} role="status">
                {uploadMessage.tone === 'success' && <Icon name="check" size={16} />}
                {uploadMessage.text}
              </div>
            )}

            <button type="button" className="btn btn-primary btn-wide" onClick={handleUpload} disabled={!selectedFiles.length}>
              <Icon name="upload" size={18} />
              {!selectedFiles.length ? 'Upload tracks' : uploadQueue && uploadQueue.status !== 'done' ? `Upload remaining ${plural(selectedFiles.length, 'track')}` : `Upload ${plural(selectedFiles.length, 'track')}`}
            </button>
          </>
        )}
      </div>

      <aside className="upload-side">
        <div className="info-box">
          <h3>Before you upload</h3>
          <ul>
            <li>Drop a single track or a full album folder.</li>
            <li>Big selections are sent in small groups, so you can cancel any time.</li>
            <li>Files that are not audio are skipped automatically.</li>
          </ul>
        </div>

        <div className="info-box">
          <h3>Recent uploads</h3>
          {recentUploads.length ? (
            <ul className="recent-list">
              {recentUploads.map((track) => (
                <li key={track.id}>
                  <CoverArt track={track} size="sm" />
                  <span>
                    <strong>{track.title}</strong>
                    <small>{track.artist}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-text">No uploads yet. Your new tracks will show up here.</p>
          )}
        </div>
      </aside>
    </div>
  );

  const renderLab = () => (
    <>
      <div className="tabs" role="tablist" aria-label="Appearance sections">
        {[
          ['themes', 'Themes'],
          ['colors', 'Colors'],
          ['settings', 'Settings']
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={labTab === id} className={`tab-link ${labTab === id ? 'is-active' : ''}`} onClick={() => setLabTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {labTab === 'themes' && (
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {[
            ['light', 'Paper', 'Warm daylight, ink black type'],
            ['dark', 'Night', 'A dim listening room'],
            ['system', 'System', 'Follows your device']
          ].map(([id, label, note]) => (
            <button key={id} type="button" role="radio" aria-checked={prefs.theme === id} className={`theme-card ${prefs.theme === id ? 'is-active' : ''}`} onClick={() => updatePrefs({ theme: id })}>
              <span className={`theme-preview is-${id}`}>
                <i className="tp-title" />
                <i className="tp-line" />
                <i className="tp-line is-short" />
                <i className="tp-deck" />
              </span>
              <span className="theme-label">
                <span>
                  <strong>{label}</strong>
                  <small>{note}</small>
                </span>
                {prefs.theme === id && <Icon name="check" size={18} className="theme-check" />}
              </span>
            </button>
          ))}
        </div>
      )}

      {labTab === 'colors' && (
        <div className="colors-layout">
          <div className="info-box">
            <h3>Accent color</h3>
            <p className="muted-text">A single signal color for progress, hearts and what is playing.</p>
            <div className="swatches" role="radiogroup" aria-label="Accent color">
              {accentOptions.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={prefs.accent === option.id} aria-label={option.name} title={option.name} className={`swatch ${prefs.accent === option.id ? 'is-active' : ''}`} style={{ '--swatch': option[resolvedTheme] }} onClick={() => updatePrefs({ accent: option.id })} />
              ))}
              <label className={`swatch swatch-custom ${prefs.accent === 'custom' ? 'is-active' : ''}`} style={{ '--swatch': prefs.accent === 'custom' ? prefs.customAccent : 'transparent' }} title="Custom color">
                <Icon name="palette" size={16} />
                <input type="color" value={prefs.customAccent} onChange={(event) => updatePrefs({ accent: 'custom', customAccent: event.target.value })} aria-label="Custom accent color" />
              </label>
            </div>
            <p className="swatch-name">{prefs.accent === 'custom' ? `Custom ${prefs.customAccent.toUpperCase()}` : accentOptions.find((option) => option.id === prefs.accent)?.name}</p>
            <div className="chips" role="group" aria-label="Color intensity">
              {['subtle', 'balanced', 'immersive'].map((intensity) => <button key={intensity} type="button" className={`chip ${prefs.accentIntensity === intensity ? 'is-active' : ''}`} aria-pressed={prefs.accentIntensity === intensity} onClick={() => updatePrefs({ accentIntensity: intensity })}>{intensity[0].toUpperCase() + intensity.slice(1)}</button>)}
            </div>
            <button type="button" className="text-btn" onClick={() => updatePrefs({ accent: 'poppy', customAccent: '#D83A22', accentIntensity: 'balanced' })}>
              <Icon name="reset" size={14} /> Reset to default
            </button>
          </div>

          <div className="info-box">
            <h3>Preview</h3>
            <div className="preview-deck">
              <span className="preview-record">
                <Record track={current} playing={isPlaying} spin={prefs.spin} />
              </span>
              <span className="preview-text">
                <strong>{current?.title || 'Nothing playing'}</strong>
                <small>{current?.artist || 'Pick a track to start'}</small>
              </span>
              <span className="play-fab play-fab-sm" aria-hidden="true">
                <Icon name="play" size={16} />
              </span>
              <div className="slider preview-slider" style={{ '--fill': '38%' }} aria-hidden="true" />
            </div>
            <div className="preview-row">
              <span className="btn btn-primary">Primary</span>
              <span className="sort-link is-active">Selected</span>
              <span className="switch is-on" aria-hidden="true">
                <i />
              </span>
              <Icon name="heart" size={22} filled className="preview-heart" />
            </div>
          </div>
        </div>
      )}

      {labTab === 'settings' && (
        <div className="info-box settings-box">
          <div className="setting-row username-setting">
            <div>
              <strong>Username</strong>
              <span>Shown across Sonara and shared between web and Android.</span>
            </div>
            <div className="username-setting-control">
              <input
                type="text"
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                minLength="2"
                maxLength="30"
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,29}"
                placeholder={authUser ? 'Choose a username' : 'Sign in first'}
                disabled={!authUser || usernameSaving}
                aria-label="Username"
              />
              <button type="button" className="btn btn-compact" onClick={saveUsernameFromSettings} disabled={!authUser || usernameSaving || usernameDraft.trim().length < 2}>
                {usernameSaving ? 'Saving…' : 'Save'}
              </button>
              {usernameError && <small className="username-setting-error" role="alert">{usernameError}</small>}
            </div>
          </div>
          <Toggle checked={prefs.waveforms} onChange={(value) => updatePrefs({ waveforms: value })} label="Show waveforms" description="Draws a small waveform along each line of a track list." />
          <Toggle checked={prefs.spin} onChange={(value) => updatePrefs({ spin: value })} label="Spinning records" description="Records turn while music plays. Off keeps everything still." />
          <Toggle checked={prefs.compact} onChange={(value) => updatePrefs({ compact: value })} label="Compact rows" description="Fits more tracks on screen at once." />
          <div className="setting-row">
            <div>
              <strong>Reset appearance</strong>
              <span>Restores theme, accent color and display options.</span>
            </div>
            <button type="button" className="btn" onClick={() => updatePrefs({ theme: 'light', accent: 'poppy', waveforms: true, compact: false, spin: true })}>
              Reset
            </button>
          </div>
        </div>
      )}
    </>
  );

  const renderAdmin = () => {
    if (!isAdmin) {
      return (
        <div className="info-box" style={{ padding: '2rem', textAlign: 'center' }}>
          <h3>Access Restricted</h3>
          <p className="muted-text">Admin privileges are required to view catalog controls and storage metrics.</p>
        </div>
      );
    }

    if (adminLoading || !adminStats) {
      return (
        <div className="info-box" style={{ padding: '2rem', textAlign: 'center' }}>
          <h3>Loading Cloudflare R2 Storage Metrics...</h3>
        </div>
      );
    }

    const { summary, userBreakdown } = adminStats;
    const freeTierGB = summary?.r2FreeTierGB || 10;
    const totalGB = summary?.totalStorageGB || 0;
    const usagePercent = Math.min(100, Math.round((totalGB / freeTierGB) * 100));

    return (
      <div className="admin-dashboard">
        <section className="admin-catalog-panel">
          <div className="admin-panel-head">
            <div>
              <span className="feature-kicker">Catalog & Genres</span>
              <h2>Keep the classifier queue moving</h2>
              <p className="muted-text">New uploads enter the queue automatically. A track can only belong to one export batch at a time.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={loadAdminCatalog} disabled={adminActionLoading}>Refresh queue</button>
          </div>

          <div className="admin-count-grid">
            <div className="admin-count-card is-waiting"><span>Waiting for genres</span><strong>{adminCounts.pending}</strong><small>next export candidates</small></div>
            <div className="admin-count-card"><span>Exported</span><strong>{adminCounts.exported}</strong><small>awaiting returned CSVs</small></div>
            <div className="admin-count-card"><span>Classified</span><strong>{adminCounts.classified}</strong><small>available to mixes</small></div>
            <div className="admin-count-card is-review"><span>Needs review</span><strong>{adminCounts.needsReview}</strong><small>low-confidence results</small></div>
          </div>

          <div className="admin-export-bar">
            <div>
              <strong>{adminCounts.pending} new songs waiting for genres</strong>
              <span>Exporting claims them so a later export cannot repeat them.</span>
            </div>
            <div className="admin-export-actions">
              <label className="admin-size-control">Batch size<select value={adminExportSize} onChange={(event) => setAdminExportSize(Number(event.target.value))}><option value="50">50</option><option value="100">100</option><option value="200">200</option><option value="500">500</option></select></label>
              <button type="button" className="btn btn-primary" onClick={exportAdminBatch} disabled={!adminCounts.pending || adminActionLoading}>Export next batch</button>
            </div>
          </div>

          <div className="admin-import-grid">
            <div className="admin-import-box">
              <div className="admin-panel-head compact"><div><h3>Import classified batch</h3><p className="muted-text">Choose the completed CSV. Sonara checks its batch ID before applying anything.</p></div></div>
              <label className="admin-file-drop" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('is-dragging'); }} onDragLeave={(event) => event.currentTarget.classList.remove('is-dragging')} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('is-dragging'); loadAdminCsvFile(event.dataTransfer.files?.[0]); }}>
                <Icon name="upload" size={24} />
                <strong>{adminCsvName || 'Drop the completed CSV here'}</strong>
                <span>{adminCsvName ? 'File ready for validation' : 'or click to choose a batch file'}</span>
                <span className="admin-file-choose">Choose CSV</span>
                <input type="file" accept=".csv,text/csv" hidden onChange={(event) => { loadAdminCsvFile(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              <div className="admin-import-actions"><button type="button" className="btn btn-primary" onClick={previewAdminImport} disabled={!adminCsvText.trim() || adminActionLoading}>Preview CSV</button>{adminPreview?.ok && <button type="button" className="btn" onClick={applyAdminImport} disabled={adminActionLoading}>Apply {adminPreview.accepted.length} rows</button>}{adminCsvName && <button type="button" className="text-btn" onClick={() => { setAdminCsvName(''); setAdminCsvText(''); setAdminPreview(null); }}>Remove file</button>}</div>
              {adminPreview && <div className={`admin-preview ${adminPreview.ok ? 'is-ok' : 'is-error'}`}><strong>{adminPreview.ok ? `Batch ${adminPreview.batchId} recognized` : 'Import blocked'}</strong><span>{adminPreview.accepted.length} accepted · {adminPreview.rejected.invalidGenre.length} invalid genre · {adminPreview.rejected.wrongBatch.length} wrong batch · {adminPreview.rejected.unknownId.length} unknown track</span></div>}
            </div>
          </div>

          <div className="admin-batch-history">
            <div className="admin-panel-head compact"><div><h3>Export batches</h3><p className="muted-text">Re-download a lost CSV or deliberately return outstanding tracks to the queue.</p></div></div>
            {adminBatches.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Batch</th><th>Date</th><th>Size</th><th>Imported</th><th>Outstanding</th><th>Status</th><th /></tr></thead><tbody>{adminBatches.map((batch) => <tr key={batch.batchId}><td><strong>{batch.batchId}</strong>{batch.stale && <small className="batch-stale">Older than 7 days</small>}</td><td>{new Date(batch.createdAt).toLocaleDateString()}</td><td>{batch.exported}</td><td>{batch.imported}</td><td>{batch.outstanding}</td><td><span className={`batch-status is-${batch.status}`}>{batch.status}</span></td><td><div className="batch-actions"><button type="button" className="text-btn" onClick={() => downloadAdminBatch(batch.batchId)} disabled={adminActionLoading}>Re-download</button>{batch.outstanding > 0 && <><button type="button" className="text-btn" onClick={() => updateAdminBatch(batch.batchId, 'requeue-outstanding')} disabled={adminActionLoading}>Re-queue</button><button type="button" className="text-btn danger-text" onClick={() => updateAdminBatch(batch.batchId, 'release')} disabled={adminActionLoading}>Release</button></>}</div></td></tr>)}</tbody></table></div> : <p className="muted-text admin-empty">No export batches yet.</p>}
          </div>
        </section>

        <div className="info-box" style={{ marginBottom: '1.5rem', background: 'var(--paper)', borderRadius: '16px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 'bold' }}>👑 Cloudflare R2 Storage & Cost Calculator</h2>
              <p className="muted-text" style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
                Per-user storage usage & cost breakdown when R2 bucket exceeds 10 GB free limit ($0.015 / GB).
              </p>
            </div>
            <button type="button" className="btn btn-sm" onClick={loadAdminStats}>
              Refresh Metrics
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>TOTAL STORAGE USED</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.25rem 0' }}>
                {summary.totalStorageMB} MB <small style={{ fontSize: '0.9rem', opacity: 0.8 }}>({summary.totalStorageGB} GB)</small>
              </div>
              <span style={{ fontSize: '0.8rem', color: usagePercent > 80 ? '#ffa726' : 'inherit' }}>
                {usagePercent}% of 10 GB Free Tier
              </span>
            </div>

            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>BILLABLE OVERAGE</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.25rem 0' }}>
                {summary.billableGB} GB
              </div>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>$0.015 / GB per month</span>
            </div>

            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>ESTIMATED MONTHLY COST</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: 'var(--accent, #e53935)', margin: '0.25rem 0' }}>
                ${summary.totalEstimatedMonthlyCostUSD.toFixed(2)} / mo
              </div>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Zero bandwidth egress cost</span>
            </div>

            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>ACTIVE UPLOADERS</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 'bold', margin: '0.25rem 0' }}>
                {summary.totalUsers} <small style={{ fontSize: '0.9rem', opacity: 0.8 }}>users</small>
              </div>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{summary.totalTracks} uploaded tracks</span>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
              <span>Cloudflare R2 Free Bucket Capacity</span>
              <strong>{summary.totalStorageGB} GB / 10.0 GB</strong>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${usagePercent}%`,
                  height: '100%',
                  background: usagePercent > 90 ? '#ff5252' : usagePercent > 70 ? '#ffa726' : '#00e676',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        </div>

        <div className="info-box" style={{ background: 'var(--paper)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1.2rem' }}>User Storage & Cost Breakdown</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', opacity: 0.7 }}>
                  <th style={{ padding: '0.75rem' }}>User / Email</th>
                  <th style={{ padding: '0.75rem' }}>Tracks</th>
                  <th style={{ padding: '0.75rem' }}>Storage Used</th>
                  <th style={{ padding: '0.75rem' }}>Bucket Share</th>
                  <th style={{ padding: '0.75rem' }}>Est. Monthly Cost</th>
                </tr>
              </thead>
              <tbody>
                {(userBreakdown || []).map((u) => (
                  <tr key={u.userKey} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem' }}>
                      <strong>{u.displayName}</strong>
                      <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '0.75rem' }}>{u.trackCount}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <strong>{u.totalMB} MB</strong> ({u.totalGB} GB)
                    </td>
                    <td style={{ padding: '0.75rem' }}>{u.sharePercentage}%</td>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold', color: 'var(--accent, #e53935)' }}>
                      ${u.estimatedMonthlyCostUSD.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderNewHome = () => {
    const collectionItems = [
      { id: 'favorites', name: 'Favorites', kind: 'playlists', tracks: favoriteTracks, open: () => goTo('favorites') },
      ...playlists.map((playlist) => ({ id: playlist.id, name: playlist.name, kind: playlist.dynamic ? 'uploads' : 'playlists', tracks: playlist.tracks, open: () => openPlaylist(playlist.id) })),
      ...savedMixesWithTracks.map((mix) => ({ id: mix.id, name: mix.name, kind: 'mixes', tracks: mix.tracks, open: () => startPlayback(mix.tracks, 0, mix.name) }))
    ];
    const filteredCollection = collectionItems.filter((item) => collectionFilter === 'all' || item.kind === collectionFilter);
    const visibleCollection = filteredCollection.slice(0, collectionVisibleCount || Math.min(filteredCollection.length, 8));
    const visibleRecent = recentHistoryTracks.slice(0, recentVisibleCount || recentHistoryTracks.length);
    const saveMix = async (mix) => {
      if (!requireAuth('Sign in to save this mix.')) return;
      try {
        const response = await authenticatedJsonRequest(`${apiBase}/me/mixes`, { method: 'POST', body: JSON.stringify({ dailyMixId: mix.id, dateKey: dailyRecommendations.dateKey }) });
        const saved = await response.json();
        if (!response.ok) throw new Error(saved.message || 'Unable to save this mix.');
        setSavedMixes((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
        saveCachedSavedMixes(authUser.uid, [saved, ...savedMixes.filter((item) => item.id !== saved.id)]);
        setDailyRecommendations((previous) => ({ ...previous, mixes: previous.mixes.map((item) => item.id === mix.id ? { ...item, saved: true, savedId: saved.id } : item) }));
        setNotice('Saved to your collection.');
      } catch (error) { setNotice(error.message || 'Unable to save this mix.'); }
    };
    const playRecent = (track) => playFromList(recentHistoryTracks, recentHistoryTracks.findIndex((item) => item.id === track.id), 'Recently played');

    return (
      <div className="home-grid">
        <aside className="home-rail home-collection-rail">
          <section className="home-section collection-section">
            <SectionHead title="Your collection" note="Playlists, uploads, and saved mixes" action={<button type="button" className="text-btn" onClick={() => goTo('playlists')}>See all</button>} />
            <div className="chips" role="group" aria-label="Collection filter">
              {[['all', 'All'], ['mixes', 'Mixes'], ['playlists', 'Playlists'], ['uploads', 'Uploads']].map(([id, label]) => (
                <button key={id} type="button" className={`chip ${collectionFilter === id ? 'is-active' : ''}`} aria-pressed={collectionFilter === id} onClick={() => setCollectionFilter(id)}>{label}</button>
              ))}
            </div>
            <div ref={collectionRef} className="collection-grid" style={{ minHeight: 182 }}>
              {visibleCollection.map((item) => (
                <article key={item.id} className="collection-tile">
                  <button type="button" onClick={item.open}>
                    <CoverArt track={item.tracks[0] || { id: item.id }} size="sm" />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.kind} · {plural(item.tracks.length, 'track')}</small>
                    </span>
                  </button>
                  <button type="button" className="tile-fab" disabled={!item.tracks.length} onClick={() => startPlayback(item.tracks, 0, item.name)} aria-label={`Play ${item.name}`}>
                    <Icon name="play" size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </aside>

        <main className="home-main" ref={mixGridRef}>
          <section className="home-section mixes-section">
            <SectionHead title={authUser ? `Picked for ${displayName}` : 'Picked for today'} note={recommendedMixes.length < 10 ? 'Add more music to unlock 10 mixes.' : 'Recommended'} />
            {dailyRecommendations.state === 'loading' && <div className="shelf-skeleton" aria-label="Loading recommendations" />}
            {dailyRecommendations.state === 'error' && (
              <EmptyState icon="refresh" title="Recommendations are resting" text="Try again when the catalog is reachable." action={<button type="button" className="btn" onClick={() => setRecommendationRefresh((value) => value + 1)}>Retry</button>} />
            )}
            {dailyRecommendations.state === 'ready' && (
              <div className="mix-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, mixFit.columns)}, minmax(0, ${mixFit.cardSize}px))`, minHeight: 220 }}>
                {recommendedMixes.slice(0, 12).map((mix, index) => (
                  <article key={mix.id} className="recommendation-card" style={{ minHeight: `${Math.max(120, mixFit.cardSize || 150)}px` }}>
                    <button type="button" className="recommendation-art" onClick={() => startPlayback(mix.tracks, 0, mix.name, true)} aria-label={`Play ${mix.name}`}>
                      <span className="mix-stamp">No. {String(index + 1).padStart(2, '0')}</span>
                      <CoverArt track={mix.tracks[0]} size="fill" />
                      <span className="tile-play"><Icon name="play" size={18} /></span>
                    </button>
                    <span className="feature-kicker">Recommended</span>
                    <strong>{mix.name}</strong>
                    <small>{mix.tracks.length} songs · {totalRuntime(mix.tracks)}</small>
                    <button type="button" className={`icon-btn heart ${mix.saved ? 'is-on' : ''}`} onClick={() => saveMix(mix)} aria-label={mix.saved ? 'Saved mix' : `Save ${mix.name}`}>
                      <Icon name="heart" size={18} filled={mix.saved} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="home-rail home-history-rail">
          <section className="home-section history-panel">
            <SectionHead title="Recently played" action={<button type="button" className="text-btn" onClick={() => setPlayHistory([])}>Clear</button>} />
            {recentHistoryTracks.length ? (
              <ol ref={recentRef} className="history-list">
                {visibleRecent.map((track, index) => (
                  <li key={track.id}>
                    <button type="button" onClick={() => playRecent(track)}>
                      <CoverArt track={track} size="sm" />
                      <span>
                        <strong>{track.title}</strong>
                        <small>{track.artist}</small>
                      </span>
                      <time>{relativeTime(playHistory[index]?.at)}</time>
                      <i className={current?.id === track.id && isPlaying ? 'is-playing' : ''} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="clock" title="Nothing played yet" text="Play something and it will show up here." />
            )}
            <button type="button" className="text-btn home-see-all" onClick={() => goTo('library')}>See all</button>
          </section>
        </aside>
      </div>
    );
  };

  const pageContent = {
    'all-music': renderAllMusic,
    library: renderLibrary,
    playlists: renderPlaylists,
    favorites: renderFavorites,
    upload: renderUpload,
    lab: renderLab,
    admin: renderAdmin
  };

  const subtitle = view === 'all-music' ? (query ? `${plural(visibleTracks.length, 'result')} for “${query}”` : plural(allTracks.length, 'track')) : pageMeta[view]?.subtitle;
  const displayName = getUserDisplayName(authUser);

  return (
    <div className={`app-shell ${prefs.compact ? 'is-compact' : ''}`}>
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleAudioTimeUpdate}
        onLoadedMetadata={(event) => {
          const dur = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
          setAudioDuration(dur);
          /* Defense in depth: the backend now computes duration once at
             upload time, so this shouldn't normally be needed. It only
             matters for tracks uploaded before that fix, whose cached
             catalog entry still says 0 - once played, the browser's own
             decode fixes the display everywhere, not just the mini-player. */
          if (!current || dur <= 0 || (current.seconds && current.seconds > 0)) return;
          setCatalog((previous) => {
            const next = previous.map((song) => {
              const songId = String(song?.id ?? song?._id ?? '');
              return songId === current.id ? { ...song, duration: dur, seconds: dur } : song;
            });
            saveCachedCatalog(next);
            return next;
          });
        }}
        onEnded={(event) => {
          recordPlaybackProgress(current, event.currentTarget.currentTime, event.currentTarget.duration || current?.seconds || 0, true);
          advanceRef.current(true);
        }}
        onError={() => {
          if (current?.src) {
            setIsPlaying(false);
            setNotice('This file could not be played.');
          }
        }}
      />

      <header className="masthead">
        <button type="button" className="brandmark" onClick={() => goTo('home')} aria-label="Sonara, go to home">
          <span className="brandmark-disc" aria-hidden="true" />
          Sonara
        </button>

        <nav className="masthead-nav" aria-label="Main navigation">
          {navItems
            .filter((item) => item.id !== 'upload')
            .map((item) => (
              <button key={item.id} type="button" className={`mnav ${view === item.id ? 'is-active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => goTo(item.id)}>
                {item.label}
              </button>
            ))}
          {isAdmin && (
            <button type="button" className={`mnav ${view === 'admin' ? 'is-active' : ''}`} style={{ color: '#FFD700', fontWeight: 'bold' }} onClick={() => goTo('admin')}>
              Admin
            </button>
          )}
        </nav>

        <div className="masthead-tools">
          <label className="search">
            <Icon name="search" size={18} />
            <input type="search" value={query} onChange={(event) => handleSearch(event.target.value)} placeholder="Search your library" aria-label="Search your music" />
            {query && (
              <button type="button" className="icon-btn search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={16} />
              </button>
            )}
          </label>
          {isUploading && (
            <button type="button" className="upload-chip" onClick={() => goTo('upload')} aria-label="Open upload queue">
              <span className="spinner" aria-hidden="true" />
              Uploading {formatCount(uploadQueue.done)} / {formatCount(uploadQueue.total)}
            </button>
          )}
          {authUser ? (
            <div className="user-area">
              <button type="button" className="user-chip" onClick={() => goTo('home')} aria-label={`Signed in as ${displayName}`}>
                <span className="user-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
                <span className="user-name">{displayName}</span>
              </button>
              <i className="user-sep" aria-hidden="true" />
              <button type="button" className="signout-btn" onClick={handleSignOut} aria-label="Sign out">
                <Icon name="logout" size={17} />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-signin" onClick={() => { setAuthReason('Sign in to unlock your library and sync favorites.'); setAuthOpen(true); }}>
              Sign in
            </button>
          )}
          <button type="button" className={`btn-add ${view === 'upload' ? 'is-active' : ''}`} onClick={() => goTo('upload')} aria-label="Add music">
            <Icon name="plus" size={18} />
            <span>Add music</span>
          </button>
        </div>
      </header>

      <main className={`page ${view === 'home' ? 'is-home' : ''}`} data-view={view === 'home' ? 'home' : undefined}>
        {view === 'home' ? (
          renderNewHome()
        ) : (
          <>
            <PageBanner id={view} title={pageMeta[view]?.title} subtitle={subtitle} />
            {pageContent[view]?.()}
          </>
        )}
      </main>

      <footer className="deck" aria-label="Player">
        <button type="button" className="deck-now" onClick={() => current && setStageOpen(true)} aria-label="Open now playing">
          <span className="deck-disc">
            <Record track={current} playing={isPlaying} spin={prefs.spin} />
          </span>
          <span className="deck-text">
            <strong>{current?.title || 'Nothing playing'}</strong>
            <small>{current?.artist || 'Choose a track to begin'}</small>
          </span>
        </button>

        <div className="deck-center">
          <TransportControls isPlaying={isPlaying} shuffle={shuffle} repeat={repeat} disabled={!current} onToggle={togglePlay} onNext={() => advance(false)} onPrevious={previous} onShuffle={toggleShuffle} onRepeat={cycleRepeat} />
          <SeekBar position={position} total={total} onSeek={seekTo} disabled={!current} />
        </div>

        <div className="deck-right">
          {current && (
            <button type="button" className={`icon-btn heart ${likedIds.has(current.id) ? 'is-on' : ''}`} onClick={() => toggleLike(current.id)} aria-pressed={likedIds.has(current.id)} aria-label={likedIds.has(current.id) ? 'Remove from favorites' : 'Add to favorites'}>
              <Icon name="heart" size={19} filled={likedIds.has(current.id)} />
            </button>
          )}
          <DjButton active={djOn} onClick={toggleDj} />
          <div className="volume">
            <button type="button" className="icon-btn" onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute' : 'Mute'}>
              <Icon name={muted || prefs.volume === 0 ? 'mute' : 'volume'} size={18} />
            </button>
            <input
              type="range"
              className="slider"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : prefs.volume}
              style={{ '--fill': `${(muted ? 0 : prefs.volume) * 100}%` }}
              onChange={(event) => {
                setMuted(false);
                updatePrefs({ volume: Number(event.target.value) });
              }}
              aria-label="Volume"
            />
          </div>
          <button type="button" className="icon-btn" onClick={() => current && setStageOpen(true)} aria-label="Expand player">
            <Icon name="expand" size={18} />
          </button>
        </div>

        <button type="button" className="deck-mobile-play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} disabled={!current}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
        </button>
        <div className="deck-line" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (position / Math.max(total, 1)) * 100)}%` }} />
        </div>
      </footer>

      {stageOpen && current && (
        <Stage
          track={current}
          isPlaying={isPlaying}
          spin={prefs.spin}
          isLiked={likedIds.has(current.id)}
          onLike={() => toggleLike(current.id)}
          contextLabel={contextLabel}
          upNext={upNext}
          onJump={jumpTo}
          djOn={djOn}
          onDj={toggleDj}
          onClose={() => setStageOpen(false)}
          position={position}
          total={total}
          onSeek={seekTo}
          onToggle={togglePlay}
          onNext={() => advance(false)}
          onPrevious={previous}
          shuffle={shuffle}
          repeat={repeat}
          onShuffle={toggleShuffle}
          onRepeat={cycleRepeat}
        />
      )}

      <nav className="tabbar" aria-label="Primary">
        {navItems
          .filter((item) => mobileTabs.includes(item.id))
          .map((item) => (
            <button key={item.id} type="button" className={view === item.id ? 'is-active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => goTo(item.id)}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
      </nav>

      {authOpen && (
        <AuthDialog mode={authMode} reason={authReason} hasAdmin={hasAdmin} onClaimAdmin={handleClaimAdmin} onClose={() => setAuthOpen(false)} onSignedIn={handleAuthSuccess} onModeChange={setAuthMode} />
      )}

      {usernameOpen && <UsernameDialog onComplete={async (profile) => {
        await updateUserProfile(authUser, profile.username);
        setAuthUser({ ...authUser, displayName: profile.username });
        setUsernameOpen(false);
        setNotice(`Welcome to Sonara, ${profile.username}.`);
      }} />}

      {playlistMenuTrack && (
        <div className="playlist-menu" role="dialog" aria-label={`Add ${playlistMenuTrack.title} to a playlist`}>
          <div className="playlist-menu-head"><strong>Add “{playlistMenuTrack.title}”</strong><button type="button" className="icon-btn" onClick={() => setPlaylistMenuTrack(null)} aria-label="Close playlist menu"><Icon name="x" size={18} /></button></div>
          <div className="playlist-menu-list">{userPlaylists.length ? userPlaylists.map((playlist) => <button key={playlist.id} type="button" className="playlist-option" onClick={() => handleAddTrackToPlaylist(playlist.id, playlistMenuTrack.id)}><span>{playlist.name}</span><small>{plural(playlist.trackIds?.length || playlist.tracks?.length || 0, 'track')}</small></button>) : <p className="muted-text">Create a playlist to save this song.</p>}</div>
          <div className="playlist-menu-form"><input type="text" value={playlistDraft} onChange={(event) => setPlaylistDraft(event.target.value)} placeholder="New playlist name" aria-label="New playlist name" /><button type="button" className="btn btn-primary" onClick={() => { if (playlistDraft.trim()) handleCreatePlaylist(playlistDraft); else { setPlaylistComposer({ mode: 'create', playlistId: null, name: '' }); setPlaylistDraft(''); } }}>Create</button></div>
        </div>
      )}

      {playlistComposer && (
        <div className="playlist-editor" role="dialog" aria-label={playlistComposer.mode === 'rename' ? 'Rename playlist' : 'Create playlist'}>
          <div className="playlist-menu-head"><strong>{playlistComposer.mode === 'rename' ? 'Rename playlist' : 'New playlist'}</strong><button type="button" className="icon-btn" onClick={() => { setPlaylistComposer(null); setPlaylistDraft(''); }} aria-label="Close playlist editor"><Icon name="x" size={18} /></button></div>
          <label className="playlist-editor-field"><span>Playlist name</span><input type="text" value={playlistDraft} onChange={(event) => setPlaylistDraft(event.target.value)} placeholder="Weekend drives" aria-label="Playlist name" /></label>
          <div className="playlist-editor-actions"><button type="button" className="btn" onClick={() => { setPlaylistComposer(null); setPlaylistDraft(''); }}>Cancel</button><button type="button" className="btn btn-primary" onClick={() => { if (!playlistDraft.trim()) return; if (playlistComposer.mode === 'rename') handleRenamePlaylist(playlistComposer.playlistId, playlistDraft); else handleCreatePlaylist(playlistDraft); }}>{playlistComposer.mode === 'rename' ? 'Save' : 'Create'}</button></div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}