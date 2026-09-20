import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authenticatedJsonRequest, createAccountWithEmail, getCurrentIdToken, isFirebaseConfigured, signInWithEmail, signInWithGoogle, signOutUser, subscribeToAuth } from './firebaseAuth';

/* -------------------------------------------------------------------------- */
/*  Config                                                                    */
/* -------------------------------------------------------------------------- */

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const STORAGE_KEY = 'sonara.web.prefs.v2';
const CATALOG_CACHE_KEY = 'sonara.web.catalog.v1';
const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|wma|m4b|m4r)$/i;

const fallbackCatalog = [
  { id: 'seed-night-drive', title: 'Night Drive', artist: 'Sonara Studio', album: 'Afterglow', seconds: 232, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', addedAt: Date.now() - 1000 },
  { id: 'seed-dream-state', title: 'Dream State', artist: 'North Echo', album: 'Late Bloom', seconds: 201, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', addedAt: Date.now() - 2000 },
  { id: 'seed-sunset-loop', title: 'Sunset Loop', artist: 'Glass Harbor', album: 'Warm Static', seconds: 246, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', addedAt: Date.now() - 3000 },
  { id: 'seed-hollow-glow', title: 'Hollow Glow', artist: 'Daybreak Ritual', album: 'Low Tide', seconds: 218, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', addedAt: Date.now() - 4000 },
  { id: 'seed-velvet-run', title: 'Velvet Run', artist: 'Cinder Avenue', album: 'Night Circuit', seconds: 247, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', addedAt: Date.now() - 5000 },
  { id: 'seed-lunar-kite', title: 'Lunar Kite', artist: 'Harbor Echo', album: 'Cassette Air', seconds: 261, audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', addedAt: Date.now() - 6000 }
];

const getCachedCatalog = () => {
  try {
    const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getDefaultCatalog = () => {
  const cached = getCachedCatalog();
  return cached.length ? cached : fallbackCatalog;
};

const saveCachedCatalog = (songs) => {
  try {
    window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(songs));
  } catch {
    // storage is unavailable, ignore gracefully
  }
};

const getUserDisplayName = (user) => {
  if (!user) return 'Listener';
  if (user.displayName) return user.displayName.trim();
  if (user.email) return user.email.split('@')[0] || 'Listener';
  return 'Listener';
};

/* Uploads run in groups so huge selections stay fast and cancellable. */
const BATCH_OPTIONS = [5, 10, 25, 50];
const DEFAULT_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 2;
const MAX_CONSECUTIVE_FAILURES = 3;

const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'all-music', label: 'All Music', icon: 'music' },
  { id: 'playlists', label: 'Playlists', icon: 'list' },
  { id: 'favorites', label: 'Favorites', icon: 'heart' },
  { id: 'upload', label: 'Upload', icon: 'upload' },
  { id: 'lab', label: 'Lab', icon: 'palette' }
];

const mobileTabs = ['home', 'library', 'all-music', 'lab'];
const protectedViews = new Set(['upload', 'playlists', 'favorites']);

const pageMeta = {
  library: { title: 'Library', subtitle: 'Everything you have saved, in one place.' },
  'all-music': { title: 'All Music', subtitle: '' },
  playlists: { title: 'Playlists', subtitle: 'Collections built around your sound and mood.' },
  favorites: { title: 'Favorites', subtitle: 'The songs you keep coming back to.' },
  upload: { title: 'Add music', subtitle: 'Bring in tracks, albums or whole folders. Big batches go in small groups.' },
  lab: { title: 'Appearance Lab', subtitle: 'Make Sonara look and feel the way you like.' }
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
  if (!value.startsWith('/')) return '';
  try {
    return new URL(value, new URL(apiBase, window.location.href).origin).toString();
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
      <span className="record-label">{track ? <CoverArt track={track} size="fill" round /> : null}</span>
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

function AuthDialog({ mode, reason, onClose, onSignedIn, onModeChange }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (result) => onSignedIn(result.user);
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
        <button type="button" className="btn auth-google" onClick={google} disabled={busy || !isFirebaseConfigured}>Continue with Google</button>
        <div className="auth-divider"><span>or use email</span></div>
        <form onSubmit={submit}>
          <label className="auth-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength="6" required /></label>
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


function Tracklist({ tracks, currentId, isPlaying, likedIds, onPlay, onToggleLike, showWaveform }) {
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
  const [view, setView] = useState('home');
  const [playlistId, setPlaylistId] = useState('daily-mix');
  const [libraryTab, setLibraryTab] = useState('songs');
  const [labTab, setLabTab] = useState('themes');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [notice, setNotice] = useState('');
  const [stageOpen, setStageOpen] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [authReason, setAuthReason] = useState('Sign in to unlock this feature.');
  const [userPlaylists, setUserPlaylists] = useState([]);
  const [libraryHydrated, setLibraryHydrated] = useState(false);

  const handleAuthSuccess = useCallback((user) => {
    setAuthUser(user);
    setAuthOpen(false);
    setAuthMode('signin');
    setAuthReason('Sign in to unlock this feature.');
    if (user) setNotice(`Welcome back, ${getUserDisplayName(user)}.`);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOutUser();
    } finally {
      setAuthUser(null);
      setUserPlaylists([]);
      setLibraryHydrated(false);
      setNotice('Signed out.');
    }
  }, []);

  /* catalog + upload */
  const [catalog, setCatalog] = useState([]);
  const [sessionUploads, setSessionUploads] = useState([]);
  const [serverOnline, setServerOnline] = useState(null);
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
    let active = true;
    if (!authUser) {
      setLibraryHydrated(false);
      setUserPlaylists([]);
      return undefined;
    }
    (async () => {
      try {
        const response = await authenticatedJsonRequest(`${apiBase}/me/library`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load your library.');
        if (!active) return;
        setPrefs((previous) => ({
          ...previous,
          ...(data.preferences || {}),
          liked: Array.isArray(data.preferences?.liked) ? data.preferences.liked : previous.liked
        }));
        setUserPlaylists(Array.isArray(data.playlists) ? data.playlists : []);
      } catch (error) {
        if (active) setNotice(error.message || 'Unable to load your library.');
      } finally {
        if (active) setLibraryHydrated(true);
      }
    })();
    return () => { active = false; };
  }, [authUser]);

  useEffect(() => {
    if (!authUser || !libraryHydrated) return;
    const syncUserLibrary = async () => {
      try {
        const payload = {
          preferences: {
            theme: prefs.theme,
            accent: prefs.accent,
            customAccent: prefs.customAccent,
            waveforms: prefs.waveforms,
            compact: prefs.compact,
            spin: prefs.spin,
            volume: prefs.volume,
            liked: prefs.liked
          },
          playlists: userPlaylists
        };
        const response = await authenticatedJsonRequest(`${apiBase}/me/library`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Unable to sync your library.');
        }
      } catch (error) {
        setNotice(error.message || 'Unable to sync your library.');
      }
    };
    syncUserLibrary();
  }, [authUser, libraryHydrated, prefs, userPlaylists]);

  const current = queue[pos] || null;
  const total = audioDuration || current?.seconds || 0;
  const resolvedTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  const likedIds = useMemo(() => new Set(prefs.liked), [prefs.liked]);

  const updatePrefs = useCallback((patch) => setPrefs((previous) => ({ ...previous, ...patch })), []);

  const requireAuth = useCallback((reason) => {
    if (authUser) return true;
    setAuthReason(reason);
    setAuthOpen(true);
    return false;
  }, [authUser]);

  const toggleLike = useCallback((id) => {
    if (!requireAuth('Sign in to save favorites to your account.')) return;
    setPrefs((previous) => ({
      ...previous,
      liked: previous.liked.includes(id) ? previous.liked.filter((item) => item !== id) : [...previous.liked, id]
    }));
  }, [requireAuth]);

  /* ------------------------------ data ------------------------------ */

  const fetchCatalog = useCallback(async () => {
    const seededCatalog = getDefaultCatalog();
    setCatalog(seededCatalog);
    saveCachedCatalog(seededCatalog);
    setServerOnline(false);

    try {
      const response = await fetch(`${apiBase}/catalog`);
      if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
      const payload = await response.json();
      const songs = Array.isArray(payload?.songs) ? payload.songs : Array.isArray(payload) ? payload : [];
      if (!songs.length) {
        setCatalog(seededCatalog);
        saveCachedCatalog(seededCatalog);
        setServerOnline(false);
        return;
      }

      setCatalog(songs);
      saveCachedCatalog(songs);
      setServerOnline(true);
    } catch (error) {
      console.error('Unable to load catalog', error);
      const activeCatalog = getDefaultCatalog();
      setCatalog(activeCatalog);
      saveCachedCatalog(activeCatalog);
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const catalogTracks = useMemo(() => catalog.map(normalizeTrack), [catalog]);
  const allTracks = catalogTracks;
  const trackById = useMemo(() => new Map(allTracks.map((track) => [track.id, track])), [allTracks]);

  const recentUploads = useMemo(() => {
    const seen = new Set();
    return [...sessionUploads, ...catalogTracks].filter((track) => (seen.has(track.id) ? false : seen.add(track.id))).slice(0, 5);
  }, [sessionUploads, catalogTracks]);

  const playlists = useMemo(
    () =>
      [...defaultPlaylists, ...userPlaylists.filter((playlist) => playlist.id !== 'uploads')].map((playlist) => ({
        ...playlist,
        tracks: playlist.dynamic === 'uploads' ? catalogTracks : playlist.trackIds.map((id) => trackById.get(id)).filter(Boolean)
      })),
    [catalogTracks, trackById, userPlaylists]
  );
  const selectedPlaylist = playlists.find((playlist) => playlist.id === playlistId) || playlists[0];
  const favoriteTracks = useMemo(() => allTracks.filter((track) => likedIds.has(track.id)), [allTracks, likedIds]);
  const recentTracks = useMemo(() => [...allTracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 6), [allTracks]);

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
    root.style.setProperty('--accent', color);
    root.style.setProperty('--on-accent', readableOn(color));
  }, [resolvedTheme, prefs.accent, prefs.customAccent]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);

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
    const first = current || allTracks[0];
    if (!first) return;
    setQueue([first, ...shuffled(allTracks.filter((track) => track.id !== first.id))]);
    setQueueBase(allTracks);
    setPos(0);
    if (first.id !== current?.id) setPosition(0);
    setContextLabel('Sonara DJ');
    setShuffle(true);
    setRepeat('off');
    setDjOn(true);
    setIsPlaying(true);
    setNotice('DJ is on. Sonara will keep the mix going.');
  };

  advanceRef.current = advance;
  controlsRef.current = { togglePlay, next: () => advance(false), previous };

  /* audio element wiring */
  useEffect(() => {
    const audio = audioRef.current;
    setAudioDuration(0);
    if (!audio) return;
    audio.pause();
    if (current?.src) {
      audio.src = current.src;
      audio.load();
    } else {
      audio.removeAttribute('src');
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
          const data = await sendUpload(
            formData,
            (fraction) => setUploadQueue((previous) => (previous ? { ...previous, batchProgress: fraction } : previous)),
            run
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
    fetchCatalog();
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

  /* ------------------------------ views ------------------------------ */

  const renderHome = () => {
    const scapes = [
      { id: 'favorites', name: 'Favorites', kind: 'Yours', tracks: favoriteTracks, open: () => goTo('favorites') },
      ...playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        kind: playlist.dynamic ? 'Library' : 'Playlist',
        tracks: playlist.tracks,
        open: () => openPlaylist(playlist.id)
      }))
    ];
    const spotlightTrack = current || recentTracks[0] || favoriteTracks[0] || allTracks[0];

    return (
      <>
        <section className="hero">
          <div className="hero-copy hero-copy-featured">
            <p className="greeting">
              <i className="live-dot" aria-hidden="true" />
              {greeting()}, {getUserDisplayName(authUser)}
            </p>
            <div className="hero-intro">
              <span className="hero-kicker">Sonara</span>
              <h1>Set the tone for the next hour.</h1>
            </div>
            <div className="feature-panel">
              <div className="feature-art">
                <SleeveStack track={spotlightTrack} playing={isPlaying} spin={prefs.spin} onClick={() => setStageOpen(true)} />
              </div>
              {spotlightTrack && (
                <div className="feature-meta">
                  <span className="feature-kicker">Now spinning</span>
                  <strong>{spotlightTrack.title}</strong>
                  <small>{spotlightTrack.artist}</small>
                </div>
              )}
              <DjButton active={djOn} onClick={toggleDj} className="feature-dj" />
            </div>
          </div>

          <div className="hero-visual hero-visual-featured">
            <div className="mini-feature-card">
              <div className="mini-feature-header">
                <span>Recently played</span>
                <button type="button" className="text-btn" onClick={() => goTo('all-music')}>View all</button>
              </div>
              <div className="mini-feature-highlight">
                {(recentTracks[0] || allTracks[0]) && (
                  <button type="button" className="mini-feature-spotlight" onClick={() => {
                    const firstTrack = recentTracks[0] || allTracks[0];
                    if (!firstTrack) return;
                    playFromList(allTracks, allTracks.findIndex((item) => item.id === firstTrack.id), 'Recently played');
                  }}>
                    <CoverArt track={recentTracks[0] || allTracks[0]} size="lg" />
                  </button>
                )}
              </div>
              <div className="mini-feature-grid">
                {(recentTracks.slice(0, 4).length ? recentTracks.slice(0, 4) : allTracks.slice(0, 4)).map((track) => (
                  <button key={track.id} type="button" className="mini-feature-tile" onClick={() => playFromList(allTracks, allTracks.findIndex((item) => item.id === track.id), 'Recently played')}>
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
          <SectionHead title="Jump back in" note="Recently added to your library" action={<button type="button" className="text-btn" onClick={() => goTo('all-music')}>See everything</button>} />
          <div className="sleeve-grid">
            {recentTracks.map((track, index) => (
              <div key={track.id} className="tile">
                <button type="button" className="tile-hit" onClick={() => playFromList(recentTracks, index, 'Recently added')}>
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
        <Tracklist tracks={visibleTracks} {...tableProps} onPlay={(index) => playFromList(visibleTracks, index, query ? `Search: ${query}` : 'All Music')} />
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

      {libraryTab === 'songs' && <Tracklist tracks={libraryTracks} {...tableProps} onPlay={(index) => playFromList(libraryTracks, index, 'Library')} />}

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

  const renderPlaylists = () => (
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
            </div>
          </div>
        </div>

        {selectedPlaylist.tracks.length ? (
          <Tracklist tracks={selectedPlaylist.tracks} {...tableProps} onPlay={(index) => playFromList(selectedPlaylist.tracks, index, selectedPlaylist.name)} />
        ) : (
          <EmptyState icon="upload" title="No uploads yet" text="Tracks you upload will appear here." action={<button type="button" className="btn" onClick={() => goTo('upload')}>Add music</button>} />
        )}
      </section>
    </div>
  );

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
        <Tracklist tracks={favoriteTracks} {...tableProps} onPlay={(index) => playFromList(favoriteTracks, index, 'Favorites')} />
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
          <p className={`server-status ${serverOnline === false ? 'is-offline' : ''}`}>
            <i />
            {serverOnline === null ? 'Checking server…' : serverOnline ? 'Connected to the Sonara server' : 'Server unreachable. Uploads will fail until it is back.'}
          </p>
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
            <button type="button" className="text-btn" onClick={() => updatePrefs({ accent: 'poppy' })}>
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

  const pageContent = {
    'all-music': renderAllMusic,
    library: renderLibrary,
    playlists: renderPlaylists,
    favorites: renderFavorites,
    upload: renderUpload,
    lab: renderLab
  };

  const subtitle = view === 'all-music' ? (query ? `${plural(visibleTracks.length, 'result')} for “${query}”` : plural(allTracks.length, 'track')) : pageMeta[view]?.subtitle;

  return (
    <div className={`app-shell ${prefs.compact ? 'is-compact' : ''}`}>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setAudioDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onEnded={() => advanceRef.current(true)}
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
            <div className="user-shell">
              <div className="user-pill">
                <button type="button" className="user-badge" onClick={() => goTo('home')} aria-label="Signed in as user">
                  <span className="user-avatar" aria-hidden="true"><Icon name="user" size={14} /></span>
                  {getUserDisplayName(authUser)}
                </button>
              </div>
              <button type="button" className="user-signout" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => { setAuthReason('Sign in to unlock your library and sync favorites.'); setAuthOpen(true); }}>
              Sign in
            </button>
          )}
          <button type="button" className={`btn-add ${view === 'upload' ? 'is-active' : ''}`} onClick={() => goTo('upload')} aria-label="Add music">
            <Icon name="plus" size={18} />
            <span>Add music</span>
          </button>
        </div>
      </header>

      <main className={`page ${view === 'home' ? 'is-home' : ''}`}>
        {view === 'home' ? (
          renderHome()
        ) : (
          <>
            <header className="page-head">
              <h1>{pageMeta[view]?.title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </header>
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
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </button>
          ))}
      </nav>

      {authOpen && (
        <AuthDialog
          mode={authMode}
          reason={authReason}
          onClose={() => setAuthOpen(false)}
          onSignedIn={handleAuthSuccess}
          onModeChange={setAuthMode}
        />
      )}

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
