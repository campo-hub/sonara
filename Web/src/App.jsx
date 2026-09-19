import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Config                                                                    */
/* -------------------------------------------------------------------------- */

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const USER_NAME = 'John';
const STORAGE_KEY = 'sonara.web.prefs.v1';
const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|wma|m4b|m4r)$/i;

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

const pageMeta = {
  library: { title: 'Library', subtitle: 'Everything you have saved, in one place.' },
  'all-music': { title: 'All Music', subtitle: '' },
  playlists: { title: 'Playlists', subtitle: 'Collections built around your sound and mood.' },
  favorites: { title: 'Favorites', subtitle: 'The songs you keep coming back to.' },
  upload: { title: 'Upload music', subtitle: 'Add tracks, albums or whole folders in one pass.' },
  lab: { title: 'Appearance Lab', subtitle: 'Make Sonara look and feel the way you like.' }
};

const sortOptions = [
  { id: 'name', label: 'Name' },
  { id: 'artist', label: 'Artist' },
  { id: 'added', label: 'Date added' },
  { id: 'duration', label: 'Longest' }
];

const accentOptions = [
  { id: 'ivory', name: 'Ivory', dark: '#ededed', light: '#151515' },
  { id: 'stone', name: 'Stone', dark: '#bdb6aa', light: '#6c655a' },
  { id: 'slate', name: 'Slate', dark: '#9aabbd', light: '#4d6076' },
  { id: 'sage', name: 'Sage', dark: '#a3b5a1', light: '#55694f' },
  { id: 'clay', name: 'Clay', dark: '#c5a898', light: '#7b5c4b' },
  { id: 'graphite', name: 'Graphite', dark: '#8f8f8f', light: '#3f3f3f' }
];

const defaultPrefs = {
  theme: 'dark',
  accent: 'ivory',
  customAccent: '#bdb6aa',
  waveforms: true,
  compact: false,
  showPanel: true,
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

const sendUpload = (formData, onProgress, run) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    if (run) run.abort = () => request.abort();
    request.open('POST', `${apiBase}/uploads/bulk`);
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
  maximize: (
    <>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    </>
  ),
  minimize: (
    <>
      <path d="M8 3v5H3M16 3v5h5M21 16h-5v5M3 16h5v5" />
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

function CoverArt({ track, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.cover]);

  if (track?.cover && !failed) {
    return <img className={`cover cover-${size}`} src={track.cover} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }

  const seed = hashString(track?.id || track?.title || 'sonara');
  const bars = Array.from({ length: 9 }, (_, index) => 5 + ((seed >>> (index * 3)) & 7) * 3);

  return (
    <span className={`cover cover-${size}`} style={{ '--tone': `var(--art-${(seed % 6) + 1})` }} aria-hidden="true">
      <svg viewBox="0 0 48 48" preserveAspectRatio="xMidYMid meet">
        {bars.map((height, index) => (
          <rect key={index} x={6.3 + index * 4.4} y={24 - height / 2} width="2.6" height={height} rx="1.3" />
        ))}
      </svg>
    </span>
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

function TrackTable({ tracks, currentId, isPlaying, likedIds, onPlay, onToggleLike, showWaveform, showAlbum = true }) {
  const columns = ['36px', 'minmax(0, 2.4fr)'];
  if (showAlbum) columns.push('minmax(0, 1.3fr)');
  if (showWaveform) columns.push('92px');
  columns.push('52px', '36px');

  return (
    <div className="track-table" role="table" style={{ '--cols': columns.join(' ') }}>
      <div className="track-head" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader">Title</span>
        {showAlbum && <span role="columnheader" className="cell-album">Album</span>}
        {showWaveform && <span className="cell-wave" aria-hidden="true" />}
        <span role="columnheader" className="cell-time">Time</span>
        <span aria-hidden="true" />
      </div>

      {tracks.map((track, index) => {
        const isCurrent = track.id === currentId;
        const isLiked = likedIds.has(track.id);
        return (
          <div key={track.id} role="row" className={`track-row ${isCurrent ? 'is-current' : ''} ${isCurrent && isPlaying ? 'is-playing' : ''}`} onDoubleClick={() => onPlay(index)}>
            <button type="button" className="row-play" onClick={() => onPlay(index)} aria-label={`${isCurrent && isPlaying ? 'Pause' : 'Play'} ${track.title}`}>
              <span className="row-index">{index + 1}</span>
              <span className="row-eq" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <Icon name={isCurrent && isPlaying ? 'pause' : 'play'} size={16} className="row-icon" />
            </button>
            <div className="row-title">
              <CoverArt track={track} size="sm" />
              <div className="row-text">
                <strong>{track.title}</strong>
                <span>{track.artist}</span>
              </div>
            </div>
            {showAlbum && <span className="row-album cell-album">{track.album}</span>}
            {showWaveform && (
              <span className="cell-wave">
                <Waveform seed={hashString(track.id)} active={isCurrent} />
              </span>
            )}
            <span className="row-time cell-time">{formatTime(track.seconds)}</span>
            <button type="button" className={`icon-btn heart ${isLiked ? 'is-on' : ''}`} onClick={() => onToggleLike(track.id)} aria-pressed={isLiked} aria-label={isLiked ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}>
              <Icon name="heart" size={18} filled={isLiked} />
            </button>
          </div>
        );
      })}
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

function UploadQueue({ queue, onCancel, onDismiss }) {
  const running = queue.status === 'running';
  const percent = Math.floor(queueFraction(queue) * 100);
  const inFlight = running ? queue.batchProgress * queue.currentSize : 0;
  const untouched = Math.max(0, queue.total - queue.done - queue.failed);
  const elapsed = (Date.now() - queue.startedAt) / 1000;
  const rate = running && elapsed > 3 ? (queue.done + inFlight) / elapsed : 0;
  const eta = rate > 0 ? formatEta((untouched - inFlight) / rate) : '';

  const titles = {
    running: queue.cancelling ? 'Cancelling…' : 'Uploading',
    done: 'Upload complete',
    cancelled: 'Upload cancelled',
    partial: 'Finished with errors',
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
    detail = `Stopped after repeated errors${queue.error ? `: ${queue.error}` : '.'} ${formatCount(queue.remaining)} ${queue.remaining === 1 ? 'track is' : 'tracks are'} still selected.`;
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

function NowPlaying({ mode, track, isPlaying, isLiked, onLike, contextLabel, upNext, onJump, djOn, onDj, onClose, position, total, onSeek, onToggle, onNext, onPrevious, shuffle, repeat, onShuffle, onRepeat }) {
  const panelRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await panelRef.current?.requestFullscreen();
      }
    } catch {
      /* Fullscreen can be blocked by browser permissions or an embedded page. */
    }
  };

  if (!track) return null;

  return (
    <aside ref={panelRef} className={`np-panel is-${mode}`} aria-label="Now playing">
      <div className="np-top">
        {mode === 'overlay' ? (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close now playing">
            <Icon name="chevronDown" size={22} />
          </button>
        ) : (
          <span className="np-heading">Now playing</span>
        )}
        <div className="np-context">
          <small>Playing from</small>
          <strong>{contextLabel}</strong>
        </div>
        <button type="button" className="icon-btn np-fullscreen-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit full screen player' : 'Open full screen player'}>
          <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={18} />
        </button>
      </div>

      <div className="np-art">
        <CoverArt track={track} size="hero" />
      </div>

      <div className="np-meta">
        <div>
          <h2>{track.title}</h2>
          <p>{track.artist}</p>
        </div>
        <button type="button" className={`icon-btn heart ${isLiked ? 'is-on' : ''}`} onClick={onLike} aria-pressed={isLiked} aria-label={isLiked ? 'Remove from favorites' : 'Add to favorites'}>
          <Icon name="heart" size={22} filled={isLiked} />
        </button>
      </div>

      <div className="np-transport">
        <SeekBar position={position} total={total} onSeek={onSeek} />
        <TransportControls isPlaying={isPlaying} shuffle={shuffle} repeat={repeat} onToggle={onToggle} onNext={onNext} onPrevious={onPrevious} onShuffle={onShuffle} onRepeat={onRepeat} />
      </div>

      <div className="np-dj">
        <DjButton active={djOn} onClick={onDj} idleLabel="Start DJ session" />
        {djOn && <p>Sonara is choosing what plays next.</p>}
      </div>

      <div className="np-queue">
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
          <p className="np-empty">Nothing queued after this track.</p>
        )}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/*  App                                                                       */
/* -------------------------------------------------------------------------- */

export default function App() {
  /* navigation + preferences */
  const [view, setView] = useState('home');
  const [playlistId, setPlaylistId] = useState('uploads');
  const [libraryTab, setLibraryTab] = useState('songs');
  const [labTab, setLabTab] = useState('themes');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [notice, setNotice] = useState('');
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);

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
  const mainRef = useRef(null);
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const advanceRef = useRef(() => {});
  const uploadRunRef = useRef({ cancelled: false, abort: null });
  const controlsRef = useRef({});

  const isWide = useMediaQuery('(min-width: 1280px)');
  const isUploading = uploadQueue?.status === 'running';
  const uploadPercent = Math.floor(queueFraction(uploadQueue) * 100);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');

  const current = queue[pos] || null;
  const total = audioDuration || current?.seconds || 0;
  const resolvedTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;
  const likedIds = useMemo(() => new Set(prefs.liked), [prefs.liked]);
  const panelMode = isWide ? (prefs.showPanel ? 'docked' : null) : nowPlayingOpen ? 'overlay' : null;

  const updatePrefs = useCallback((patch) => setPrefs((previous) => ({ ...previous, ...patch })), []);

  const toggleLike = useCallback((id) => {
    setPrefs((previous) => ({
      ...previous,
      liked: previous.liked.includes(id) ? previous.liked.filter((item) => item !== id) : [...previous.liked, id]
    }));
  }, []);

  /* ------------------------------ data ------------------------------ */

  const fetchCatalog = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/catalog`);
      if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
      const payload = await response.json();
      const songs = Array.isArray(payload?.songs) ? payload.songs : Array.isArray(payload) ? payload : [];
      setCatalog(songs);
      setServerOnline(true);
    } catch (error) {
      console.error('Unable to load catalog', error);
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
      defaultPlaylists.map((playlist) => ({
        ...playlist,
        tracks: playlist.dynamic === 'uploads' ? catalogTracks : playlist.trackIds.map((id) => trackById.get(id)).filter(Boolean)
      })),
    [catalogTracks, trackById]
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
    mainRef.current?.scrollTo({ top: 0 });
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
        setUploadQueue((previous) => ({ ...previous, done, batchProgress: 0 }));
      } else {
        failed += group.length;
        streak += 1;
        setUploadQueue((previous) => ({ ...previous, failed, batchProgress: 0 }));
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
    setView(id);
    setNowPlayingOpen(false);
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

  const toggleNowPlaying = () => {
    if (isWide) updatePrefs({ showPanel: !prefs.showPanel });
    else setNowPlayingOpen((open) => !open);
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

  const renderHome = () => (
    <>
      <section className="home-hero">
        <p className="greeting">
          {greeting()}, {USER_NAME}
        </p>
        <h1>What do you want to hear?</h1>
        <p className="hero-sub">Let Sonara set the vibe.</p>
        <DjButton active={djOn} onClick={toggleDj} />
      </section>

      <section className="block">
        <SectionHead title="Soundscapes" note="Curated vibes for your mood" />
        <div className="scape-grid">
          {[
            { id: 'favorites', name: 'Favorites', icon: 'heart', tracks: favoriteTracks, open: () => goTo('favorites') },
            ...playlists.map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              icon: playlist.dynamic ? 'upload' : 'list',
              tracks: playlist.tracks,
              open: () => openPlaylist(playlist.id)
            }))
          ].map((scape) => (
            <div key={scape.id} className="scape-card">
              <button type="button" className="scape-body" onClick={scape.open}>
                <span className="scape-icon">
                  <Icon name={scape.icon} size={18} />
                </span>
                <span className="scape-text">
                  <strong>{scape.name}</strong>
                  <small>{plural(scape.tracks.length, 'track')}</small>
                </span>
              </button>
              <button type="button" className="scape-play" disabled={!scape.tracks.length} onClick={() => startPlayback(scape.tracks, 0, scape.name)} aria-label={`Play ${scape.name}`}>
                <Icon name="play" size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <SectionHead title="Jump back in" note="Recently added to your library" action={<button type="button" className="text-btn" onClick={() => goTo('all-music')}>See all</button>} />
        <div className="tile-grid">
          {recentTracks.map((track, index) => (
            <button key={track.id} type="button" className="tile" onClick={() => playFromList(recentTracks, index, 'Recently added')}>
              <span className="tile-art">
                <CoverArt track={track} size="fill" />
                <span className="tile-play">
                  <Icon name={current?.id === track.id && isPlaying ? 'pause' : 'play'} size={16} />
                </span>
              </span>
              <strong>{track.title}</strong>
              <small>{track.artist}</small>
            </button>
          ))}
        </div>
      </section>
    </>
  );

  const renderAllMusic = () => (
    <>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Sort tracks">
          {sortOptions.map((option) => (
            <button key={option.id} type="button" className={`chip ${sortKey === option.id ? 'is-active' : ''}`} aria-pressed={sortKey === option.id} onClick={() => setSortKey(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        {query && (
          <button type="button" className="text-btn" onClick={() => setQuery('')}>
            Clear search for “{query}”
          </button>
        )}
      </div>
      {visibleTracks.length ? (
        <TrackTable tracks={visibleTracks} {...tableProps} onPlay={(index) => playFromList(visibleTracks, index, query ? `Search: ${query}` : 'All Music')} />
      ) : (
        <EmptyState icon="search" title="No matches" text={`Nothing in your library matches “${query}”.`} action={<button type="button" className="btn" onClick={() => setQuery('')}>Clear search</button>} />
      )}
    </>
  );

  const renderLibrary = () => (
    <>
      <div className="segmented" role="tablist" aria-label="Library sections">
        {[
          ['songs', 'Songs'],
          ['albums', 'Albums'],
          ['artists', 'Artists'],
          ['playlists', 'Playlists']
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={libraryTab === id} className={libraryTab === id ? 'is-active' : ''} onClick={() => setLibraryTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {libraryTab === 'songs' && <TrackTable tracks={libraryTracks} {...tableProps} onPlay={(index) => playFromList(libraryTracks, index, 'Library')} />}

      {libraryTab === 'albums' && (
        <div className="tile-grid">
          {albums.map((album) => (
            <div key={album.name} className="tile-card">
              <button type="button" className="tile" onClick={() => searchFor(album.name)}>
                <span className="tile-art">
                  <CoverArt track={album.items[0]} size="fill" />
                </span>
                <strong>{album.name}</strong>
                <small>{plural(album.items.length, 'track')}</small>
              </button>
              <button type="button" className="tile-fab" onClick={() => startPlayback(album.items, 0, album.name)} aria-label={`Play ${album.name}`}>
                <Icon name="play" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {libraryTab === 'artists' && (
        <div className="artist-grid">
          {artists.map((artist) => (
            <div key={artist.name} className="artist-card">
              <button type="button" className="artist-main" onClick={() => searchFor(artist.name)}>
                <span className="avatar">{artist.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{artist.name}</strong>
                  <small>{plural(artist.items.length, 'track')}</small>
                </span>
              </button>
              <button type="button" className="icon-btn" onClick={() => startPlayback(artist.items, 0, artist.name)} aria-label={`Play ${artist.name}`}>
                <Icon name="play" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {libraryTab === 'playlists' && (
        <div className="list-stack">
          {[{ id: 'favorites', name: 'Favorites', description: 'Songs you have hearted', tracks: favoriteTracks }, ...playlists].map((playlist) => (
            <button key={playlist.id} type="button" className="list-card" onClick={() => (playlist.id === 'favorites' ? goTo('favorites') : openPlaylist(playlist.id))}>
              <span className="scape-icon">
                <Icon name={playlist.id === 'favorites' ? 'heart' : 'list'} size={18} />
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
    <div className="playlist-layout">
      <aside className="playlist-picker" aria-label="Choose a playlist">
        {playlists.map((playlist) => (
          <button key={playlist.id} type="button" className={`picker-item ${playlist.id === selectedPlaylist.id ? 'is-active' : ''}`} onClick={() => setPlaylistId(playlist.id)}>
            <Icon name={playlist.dynamic ? 'upload' : 'list'} size={16} />
            <span>{playlist.name}</span>
            <em>{playlist.tracks.length}</em>
          </button>
        ))}
      </aside>

      <section className="playlist-main">
        <div className="playlist-head">
          <div className="playlist-cover">
            <CoverArt track={{ id: selectedPlaylist.id }} size="fill" />
          </div>
          <div className="playlist-info">
            <h2>{selectedPlaylist.name}</h2>
            <p>{selectedPlaylist.description}</p>
            <small>
              {plural(selectedPlaylist.tracks.length, 'track')}
              {selectedPlaylist.tracks.length ? `, ${totalRuntime(selectedPlaylist.tracks)}` : ''}
            </small>
          </div>
          <div className="playlist-actions">
            <button type="button" className="btn btn-primary" disabled={!selectedPlaylist.tracks.length} onClick={() => startPlayback(selectedPlaylist.tracks, 0, selectedPlaylist.name, false)}>
              <Icon name="play" size={16} /> Play
            </button>
            <button type="button" className="btn" disabled={!selectedPlaylist.tracks.length} onClick={() => startPlayback(selectedPlaylist.tracks, Math.floor(Math.random() * selectedPlaylist.tracks.length), selectedPlaylist.name, true)}>
              <Icon name="shuffle" size={16} /> Shuffle
            </button>
          </div>
        </div>

        {selectedPlaylist.tracks.length ? (
          <TrackTable tracks={selectedPlaylist.tracks} {...tableProps} onPlay={(index) => playFromList(selectedPlaylist.tracks, index, selectedPlaylist.name)} />
        ) : (
          <EmptyState icon="upload" title="No uploads yet" text="Tracks you upload will appear here." action={<button type="button" className="btn" onClick={() => goTo('upload')}>Upload music</button>} />
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
        <TrackTable tracks={favoriteTracks} {...tableProps} onPlay={(index) => playFromList(favoriteTracks, index, 'Favorites')} />
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
            <div className="segmented" role="tablist" aria-label="Upload source">
              {[
                ['files', 'Files'],
                ['folder', 'Folder']
              ].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={uploadMode === id} className={uploadMode === id ? 'is-active' : ''} onClick={() => setUploadMode(id)}>
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
              <span className="drop-icon">
                <Icon name={uploadMode === 'folder' ? 'folder' : 'upload'} size={24} />
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
                    <strong>{formatCount(selectedFiles.length)} {selectedFiles.length === 1 ? 'track' : 'tracks'} selected</strong>
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
            <li>Artwork and details are read from the files themselves.</li>
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
      <div className="segmented" role="tablist" aria-label="Appearance sections">
        {[
          ['themes', 'Themes'],
          ['colors', 'Colors'],
          ['settings', 'Settings']
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={labTab === id} className={labTab === id ? 'is-active' : ''} onClick={() => setLabTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {labTab === 'themes' && (
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {[
            ['dark', 'Dark', 'moon'],
            ['light', 'Light', 'sun'],
            ['system', 'System', 'monitor']
          ].map(([id, label, icon]) => (
            <button key={id} type="button" role="radio" aria-checked={prefs.theme === id} className={`theme-card ${prefs.theme === id ? 'is-active' : ''}`} onClick={() => updatePrefs({ theme: id })}>
              <span className={`theme-preview is-${id}`}>
                <i />
                <i />
                <i />
              </span>
              <span className="theme-label">
                <Icon name={icon} size={16} />
                {label}
                {prefs.theme === id && <Icon name="check" size={16} className="theme-check" />}
              </span>
            </button>
          ))}
        </div>
      )}

      {labTab === 'colors' && (
        <div className="colors-layout">
          <div className="info-box">
            <h3>Accent color</h3>
            <p className="muted-text">Used for active states, buttons and progress. Neutral by default.</p>
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
            <button type="button" className="text-btn" onClick={() => updatePrefs({ accent: 'ivory' })}>
              <Icon name="reset" size={14} /> Reset to default
            </button>
          </div>

          <div className="info-box preview-card">
            <h3>Preview</h3>
            <div className="preview-player">
              <CoverArt track={current} size="sm" />
              <span>
                <strong>{current?.title || 'Nothing playing'}</strong>
                <small>{current?.artist || 'Pick a track to start'}</small>
              </span>
              <span className="play-fab play-fab-sm" aria-hidden="true">
                <Icon name="play" size={16} />
              </span>
            </div>
            <div className="slider preview-slider" style={{ '--fill': '38%' }} aria-hidden="true" />
            <div className="preview-row">
              <span className="btn btn-primary">Primary</span>
              <span className="chip is-active">Selected</span>
              <span className="switch is-on" aria-hidden="true">
                <i />
              </span>
            </div>
          </div>
        </div>
      )}

      {labTab === 'settings' && (
        <div className="info-box settings-box">
          <Toggle checked={prefs.waveforms} onChange={(value) => updatePrefs({ waveforms: value })} label="Show waveforms" description="Adds a small waveform to each row in track lists." />
          <Toggle checked={prefs.compact} onChange={(value) => updatePrefs({ compact: value })} label="Compact rows" description="Fits more tracks on screen at once." />
          <Toggle checked={prefs.showPanel} onChange={(value) => updatePrefs({ showPanel: value })} label="Now playing panel" description="Keeps the panel open beside your music on wide screens." />
          <div className="setting-row">
            <div>
              <strong>Reset appearance</strong>
              <span>Restores theme, accent color and display options.</span>
            </div>
            <button type="button" className="btn" onClick={() => updatePrefs({ theme: 'dark', accent: 'ivory', waveforms: true, compact: false, showPanel: true })}>
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
    <div className={`app-shell ${panelMode === 'docked' ? 'has-panel' : ''} ${prefs.compact ? 'is-compact' : ''}`}>
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

      <aside className="sidebar">
        <div className="brand">
          <Icon name="wave" size={22} />
          <span>Sonara</span>
        </div>

        <nav className="nav-stack" aria-label="Main navigation">
          {navItems.map((item) => (
            <button key={item.id} type="button" className={`nav-item ${view === item.id ? 'is-active' : ''}`} aria-current={view === item.id ? 'page' : undefined} onClick={() => goTo(item.id)}>
              <Icon name={item.icon} size={19} />
              {item.label}
              {item.id === 'upload' && isUploading && <span className="nav-badge">{uploadPercent}%</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <p>Your playlists</p>
          <div className="side-playlists">
            {playlists.map((playlist) => (
              <button key={playlist.id} type="button" className={`side-playlist ${view === 'playlists' && selectedPlaylist.id === playlist.id ? 'is-active' : ''}`} onClick={() => openPlaylist(playlist.id)}>
                {playlist.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        <div className="topbar">
          <div className="topbar-brand">
            <Icon name="wave" size={20} />
            <span>Sonara</span>
          </div>
          <label className="search">
            <Icon name="search" size={18} />
            <input type="search" value={query} onChange={(event) => handleSearch(event.target.value)} placeholder="Search songs, artists, albums…" aria-label="Search your music" />
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
          <button type="button" className="icon-btn topbar-upload" onClick={() => goTo('upload')} aria-label="Upload music">
            <Icon name="upload" size={20} />
          </button>
        </div>

        <div className="page">
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
        </div>
      </main>

      {panelMode && (
        <NowPlaying
          mode={panelMode}
          track={current}
          isPlaying={isPlaying}
          isLiked={current ? likedIds.has(current.id) : false}
          onLike={() => current && toggleLike(current.id)}
          contextLabel={contextLabel}
          upNext={upNext}
          onJump={jumpTo}
          djOn={djOn}
          onDj={toggleDj}
          onClose={() => setNowPlayingOpen(false)}
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

      <footer className="player-bar">
        <div className="pb-track">
          <button type="button" className="pb-open" onClick={() => !isWide && setNowPlayingOpen(true)} aria-label="Open now playing">
            {current ? <CoverArt track={current} size="md" /> : <span className="cover cover-md" />}
            <span className="pb-text">
              <strong>{current?.title || 'Nothing playing'}</strong>
              <small>{current?.artist || 'Choose a track to begin'}</small>
            </span>
          </button>
          {current && (
            <button type="button" className={`icon-btn heart pb-heart ${likedIds.has(current.id) ? 'is-on' : ''}`} onClick={() => toggleLike(current.id)} aria-pressed={likedIds.has(current.id)} aria-label={likedIds.has(current.id) ? 'Remove from favorites' : 'Add to favorites'}>
              <Icon name="heart" size={18} filled={likedIds.has(current.id)} />
            </button>
          )}
        </div>

        <div className="pb-center">
          <TransportControls isPlaying={isPlaying} shuffle={shuffle} repeat={repeat} disabled={!current} onToggle={togglePlay} onNext={() => advance(false)} onPrevious={previous} onShuffle={toggleShuffle} onRepeat={cycleRepeat} />
          <SeekBar position={position} total={total} onSeek={seekTo} disabled={!current} />
        </div>

        <div className="pb-right">
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
          <button type="button" className={`icon-btn ${panelMode ? 'is-active' : ''}`} onClick={toggleNowPlaying} aria-pressed={Boolean(panelMode)} aria-label="Toggle now playing panel">
            <Icon name="panel" size={18} />
          </button>
        </div>

        <button type="button" className="pb-mobile-play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} disabled={!current}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
        </button>
        <div className="pb-line" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (position / Math.max(total, 1)) * 100)}%` }} />
        </div>
      </footer>

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

      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
