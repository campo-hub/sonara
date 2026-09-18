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
    <div className="all-pages-shell">
      <header className="pages-header glass-panel">
        <div className="brand-lockup">
          <div className="brand-mark">S</div>
          <div>
            <span className="brand-sub">all pages / screen set</span>
            <h1>SONARA</h1>
          </div>
        </div>
        <div className="header-actions">
          <span>mobile + desktop</span>
          <button>View system</button>
        </div>
      </header>

      <main className="pages-board">
        <article className="page-card intro-card glass-panel">
          <div className="page-card-header">splash / loading</div>
          <div className="brand-orbit">
            <span className="orbit large" />
            <span className="orbit mid" />
            <span className="orbit core" />
          </div>
          <div className="page-title">SONARA</div>
        </article>

        <article className="page-card auth-card glass-panel">
          <div className="page-card-header">login</div>
          <div className="field-stack">
            <span className="field line" />
            <span className="field line short" />
            <span className="action-pill" />
          </div>
        </article>

        <article className="page-card auth-card glass-panel">
          <div className="page-card-header">register</div>
          <div className="field-stack">
            <span className="field line" />
            <span className="field line" />
            <span className="field line short" />
            <span className="action-pill" />
          </div>
        </article>

        <article className="page-card home-card glass-panel">
          <div className="page-card-header">home</div>
          <div className="home-head">
            <span>Good evening</span>
            <span className="tiny-pill">DJ</span>
          </div>
          <div className="home-visual">
            <span className="visual-core" />
            <span className="visual-ring" />
          </div>
          <div className="chip-row">
            {playlistNames.map((item, index) => (
              <span key={item} className={index % 2 ? 'chip soft' : 'chip'}>{item}</span>
            ))}
          </div>
        </article>

        <article className="page-card discover-card glass-panel">
          <div className="page-card-header">discover</div>
          <div className="tile-grid">
            <span className="tile magenta" />
            <span className="tile purple" />
            <span className="tile blue" />
            <span className="tile cyan" />
          </div>
        </article>

        <article className="page-card library-card glass-panel">
          <div className="page-card-header">library</div>
          <div className="lib-tabs">
            <span>All</span>
            <span>Playlist</span>
            <span>Artist</span>
          </div>
          <div className="lib-list">
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="page-card album-card glass-panel">
          <div className="page-card-header">album / folder</div>
          <div className="album-inline">
            <span className="art-cover" />
            <div>
              <strong>Chill Collection</strong>
              <small>42 tracks · 2h 41m</small>
            </div>
          </div>
          <div className="track-lines">
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="page-card playlist-card glass-panel">
          <div className="page-card-header">playlist</div>
          <div className="audio-list">
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="page-card player-card glass-panel">
          <div className="page-card-header">full player</div>
          <div className="player-art" />
          <div className="track-bar" />
          <div className="transport-buttons">
            <span />
            <span className="center" />
            <span />
          </div>
        </article>

        <article className="page-card dj-card glass-panel">
          <div className="page-card-header">dj mode</div>
          <div className="dj-ring-shell">
            <span className="dj-ring one" />
            <span className="dj-ring two" />
          </div>
          <div className="two-pills">
            <span>Chill</span>
            <span>Queue</span>
          </div>
        </article>

        <article className="page-card settings-card glass-panel">
          <div className="page-card-header">appearance lab</div>
          <div className="swatch-row">
            <span className="swatch purple" />
            <span className="swatch cyan" />
            <span className="swatch magenta" />
          </div>
        </article>

        <article className="page-card equalizer-card glass-panel">
          <div className="page-card-header">equalizer</div>
          <div className="bar-graph">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <article className="page-card upload-card glass-panel">
          <div className="page-card-header">bulk upload</div>
          <div className="upload-box">
            <span className="upload-badge">drop folder</span>
            <span className="upload-button">choose folder</span>
          </div>
        </article>
      </main>
    </div>
  );
}
