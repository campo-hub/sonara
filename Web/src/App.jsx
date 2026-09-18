import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const galleryCards = [
  { id: 'splash', label: 'Splash / Loading', type: 'splash' },
  { id: 'login', label: 'Login', type: 'login' },
  { id: 'register', label: 'Register', type: 'register' },
  { id: 'home', label: 'Home', type: 'home' },
  { id: 'discover', label: 'Discover', type: 'discover' },
  { id: 'library', label: 'Library', type: 'library' },
  { id: 'album', label: 'Album / Folder', type: 'album' },
  { id: 'playlist', label: 'Playlist', type: 'playlist' },
  { id: 'player', label: 'Full Player', type: 'player' },
  { id: 'dj', label: 'DJ Mode', type: 'dj' },
  { id: 'appearance', label: 'Appearance Lab', type: 'appearance' },
  { id: 'equalizer', label: 'Equalizer', type: 'equalizer' },
  { id: 'sleep', label: 'Sleep Timer', type: 'sleep' },
  { id: 'options', label: 'Song Options', type: 'options' },
  { id: 'settings', label: 'Settings', type: 'settings' },
  { id: 'dashboard', label: 'Admin', type: 'dashboard' }
];

const playlistNames = ['Chill Collection', 'Workout', 'Favorites', 'Night Drive'];
const recentTracks = [
  { title: 'Neon', artist: 'Luma' },
  { title: 'Wild Echo', artist: 'Aster' },
  { title: 'Glass Sky', artist: 'Nova' },
  { title: 'Midnight', artist: 'Mira' }
];

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const [songs, setSongs] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(82);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  const activeTrack = useMemo(() => {
    if (!selectedSong) return 0.72;
    return selectedSong.duration ? Math.min(progress / selectedSong.duration, 1) : 0.72;
  }, [progress, selectedSong]);

  useEffect(() => {
    const demoSongs = [
      { id: '1', title: 'Midnight Drive', artist: 'Nova Echo', album: 'Afterglow', duration: 205, cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=600&q=80' },
      { id: '2', title: 'Velvet Static', artist: 'Aster Vale', album: 'Night Bloom', duration: 248, cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=600&q=80' },
      { id: '3', title: 'Neon Horizon', artist: 'Prism Avenue', album: 'City Lights', duration: 222, cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80' },
      { id: '4', title: 'Afterglow', artist: 'Mira Bloom', album: 'Slow Burn', duration: 196, cover: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=600&q=80' }
    ];

    setSongs(demoSongs);
    setSelectedSong(demoSongs[0]);
  }, []);

  useEffect(() => {
    if (!selectedSong) return;

    const timer = setInterval(() => {
      setProgress((current) => {
        if (!isPlaying) return current;
        const next = current + 1;
        return next >= selectedSong.duration ? selectedSong.duration : next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [selectedSong, isPlaying]);

  const handleBulkUpload = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setIsUploading(true);
    setUploadStatus('Preparing album import...');

    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name));

    try {
      const res = await fetch(`${apiBase}/uploads/bulk`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      setUploadStatus(`${data.tracks?.length || files.length} tracks imported to the library.`);
      if (data.tracks?.[0]) setSelectedSong(data.tracks[0]);
    } catch (error) {
      setUploadStatus(error.message || 'Import failed.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="reference-shell">
      <header className="reference-topbar glass-panel">
        <div className="brand-lockup">
          <div className="brand-mark">S</div>
          <div>
            <span className="brand-sub">Web App — All Pages</span>
            <h1>SONARA</h1>
          </div>
        </div>
        <div className="topbar-controls">
          <span>Save vibe</span>
          <button>Profile</button>
        </div>
      </header>

      <div className="reference-grid">
        <article className="screen-card splash-card glass-panel">
          <div className="card-header">
            <span>1.</span>
            <span>Splash / Loading</span>
          </div>
          <div className="orb-shell">
            <div className="orb-ring large" />
            <div className="orb-ring mid" />
            <div className="orb-ring small" />
          </div>
          <div className="splash-title">SONARA</div>
        </article>

        <article className="screen-card login-card glass-panel">
          <div className="card-header">
            <span>2.</span>
            <span>Login</span>
          </div>
          <div className="mini-form">
            <div className="field line" />
            <div className="field line short" />
            <div className="button-pill" />
          </div>
        </article>

        <article className="screen-card register-card glass-panel">
          <div className="card-header">
            <span>3.</span>
            <span>Register</span>
          </div>
          <div className="mini-form">
            <div className="field line" />
            <div className="field line short" />
            <div className="button-pill" />
          </div>
        </article>

        <article className="screen-card home-card glass-panel">
          <div className="card-header">
            <span>4.</span>
            <span>Home</span>
          </div>
          <div className="home-topline">
            <span>Good evening, John</span>
            <span className="pill-tag">DJ</span>
          </div>
          <div className="visualizer-wrap">
            <div className="visualizer-core" />
            <div className="visualizer-ring" />
          </div>
          <div className="playlist-row">
            {playlistNames.map((name, idx) => (
              <span key={name} className={`mini-pill ${idx % 2 ? 'soft' : ''}`}>{name}</span>
            ))}
          </div>
        </article>

        <article className="screen-card discover-card glass-panel">
          <div className="card-header">
            <span>5.</span>
            <span>Discover</span>
          </div>
          <div className="tile-grid compact">
            <span className="color-tile magenta" />
            <span className="color-tile purple" />
            <span className="color-tile blue" />
            <span className="color-tile cyan" />
          </div>
        </article>

        <article className="screen-card library-card glass-panel">
          <div className="card-header">
            <span>6.</span>
            <span>Library</span>
          </div>
          <div className="library-toolbar">
            <span>All Music</span>
            <span>Playlists</span>
            <span>Artists</span>
          </div>
          <div className="library-table">
            <div className="table-row" />
            <div className="table-row" />
            <div className="table-row" />
          </div>
        </article>

        <article className="screen-card album-card glass-panel">
          <div className="card-header">
            <span>7.</span>
            <span>Album / Folder</span>
          </div>
          <div className="album-layout">
            <div className="album-cover" />
            <div className="album-copy">
              <strong>Chill Collection</strong>
              <small>42 tracks · 2h 41m</small>
            </div>
          </div>
          <div className="track-list small">
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="screen-card playlist-card glass-panel">
          <div className="card-header">
            <span>8.</span>
            <span>Playlist</span>
          </div>
          <div className="track-list">
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="screen-card player-card glass-panel">
          <div className="card-header">
            <span>9.</span>
            <span>Full player</span>
          </div>
          <div className="player-hero">
            <div className="art-disk" />
          </div>
          <div className="track-line" />
          <div className="control-row">
            <span />
            <span className="center" />
            <span />
          </div>
        </article>

        <article className="screen-card dj-card glass-panel">
          <div className="card-header">
            <span>10.</span>
            <span>DJ Mode</span>
          </div>
          <div className="dj-visual">
            <div className="dj-orbit orbit-one" />
            <div className="dj-orbit orbit-two" />
          </div>
          <div className="stat-pills">
            <span>Chill</span>
            <span>Queue</span>
          </div>
        </article>

        <article className="screen-card appearance-card glass-panel">
          <div className="card-header">
            <span>11.</span>
            <span>Appearance Lab</span>
          </div>
          <div className="swatches">
            <span className="swatch purple" />
            <span className="swatch blue" />
            <span className="swatch magenta" />
          </div>
        </article>

        <article className="screen-card equalizer-card glass-panel">
          <div className="card-header">
            <span>12.</span>
            <span>Equalizer</span>
          </div>
          <div className="equalizer-bars">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="screen-card timer-card glass-panel">
          <div className="card-header">
            <span>13.</span>
            <span>Sleep Timer</span>
          </div>
          <div className="timer-ring" />
        </article>

        <article className="screen-card options-card glass-panel">
          <div className="card-header">
            <span>14.</span>
            <span>Song Options</span>
          </div>
          <div className="option-list">
            <span>Play</span>
            <span>Favorite</span>
            <span>Delete</span>
          </div>
        </article>

        <article className="screen-card settings-card glass-panel">
          <div className="card-header">
            <span>15.</span>
            <span>Settings</span>
          </div>
          <div className="toggle-stack">
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="screen-card admin-card glass-panel">
          <div className="card-header">
            <span>16.</span>
            <span>Admin</span>
          </div>
          <div className="admin-grid">
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>
      </div>

      <section className="utility-panel glass-panel">
        <div className="utility-left">
          <div className="utility-cover" />
          <div>
            <strong>Midnight Drive</strong>
            <span>Nova Echo</span>
          </div>
        </div>

        <div className="utility-center">
          <div className="transport-row">
            <button>♡</button>
            <button>⏮</button>
            <button className="play-toggle" onClick={() => setIsPlaying((v) => !v)}>{isPlaying ? '⏸' : '▶'}</button>
            <button>⏭</button>
            <button>↻</button>
          </div>
        </div>

        <div className="utility-right">
          <span>{formatTime(progress)}</span>
          <div className="mini-progress"><span style={{ width: `${activeTrack * 100}%` }} /></div>
          <span>{selectedSong ? formatTime(selectedSong.duration) : '3:25'}</span>
        </div>
      </section>

      <section className="upload-bar glass-panel">
        <div className="upload-copy">
          <span className="eyebrow accent">Bulk upload</span>
          <strong>Drop in an album folder or ZIP</strong>
        </div>

        <div className="upload-actions">
          <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? 'Uploading...' : 'Choose folder'}
          </button>
          <input ref={fileInputRef} type="file" multiple webkitdirectory="true" directory="true" accept="audio/*,image/*,.zip" onChange={handleBulkUpload} style={{ display: 'none' }} />
        </div>

        {uploadStatus ? <div className="upload-status">{uploadStatus}</div> : null}
      </section>
    </div>
  );
}
