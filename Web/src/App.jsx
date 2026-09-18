import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const navItems = [
  { label: 'Home', icon: '⌂', active: true },
  { label: 'Discover', icon: '◉' },
  { label: 'Library', icon: '♫' },
  { label: 'DJ', icon: '✦' },
  { label: 'Appearance Lab', icon: '◈' }
];

const samplePlaylists = [
  { name: 'Chill Collection', tracks: 42 },
  { name: 'Workout', tracks: 28 },
  { name: 'Night Drive', tracks: 24 },
  { name: 'Favorites', tracks: 16 }
];

const recentTracks = [
  { id: 1, title: 'Velvet Echo', artist: 'Nova Echo', cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=600&q=80' },
  { id: 2, title: 'Glass Horizon', artist: 'Aster Vale', cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=600&q=80' },
  { id: 3, title: 'Lunar Drift', artist: 'Prism Avenue', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80' },
  { id: 4, title: 'Afterglow', artist: 'Mira Bloom', cover: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=600&q=80' }
];

const soundscapes = [
  { name: 'Chill', tracks: 42, accent: 'pink' },
  { name: 'Workout', tracks: 28, accent: 'cyan' },
  { name: 'Focus', tracks: 18, accent: 'violet' },
  { name: 'Night Drive', tracks: 31, accent: 'gold' }
];

const themePresets = [
  { name: 'Cyber Night' },
  { name: 'Ocean Glass' },
  { name: 'Solar Flare' }
];

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const [songs, setSongs] = useState([]);
  const [featured, setFeatured] = useState({ curated: [], trending: [], mood: 'Late-night glow' });
  const [selectedSong, setSelectedSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileInputRef = useRef(null);

  async function loadData() {
    try {
      const [catalogRes, featuredRes] = await Promise.all([
        fetch(`${apiBase}/catalog`),
        fetch(`${apiBase}/featured`)
      ]);

      const catalogData = await catalogRes.json();
      const featuredData = await featuredRes.json();

      setSongs(catalogData.songs || []);
      setFeatured(featuredData);
      if ((catalogData.songs || []).length > 0) {
        setSelectedSong(catalogData.songs[0]);
      }
    } catch (error) {
      console.error('Failed to load Sonara data:', error);
    }
  }

  useEffect(() => {
    loadData();
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

  const activeTrack = useMemo(() => {
    if (!selectedSong) return 0;
    return selectedSong.duration ? Math.min(progress / selectedSong.duration, 1) : 0;
  }, [progress, selectedSong]);

  const handleSelectSong = (song) => {
    setSelectedSong(song);
    setProgress(0);
    setIsPlaying(true);
  };

  const handleBulkUpload = async (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (!selectedFiles.length) return;

    setIsUploading(true);
    setUploadStatus('Preparing bulk upload...');

    const form = new FormData();
    selectedFiles.forEach((file) => form.append('files', file, file.webkitRelativePath || file.name));

    try {
      const response = await fetch(`${apiBase}/uploads/bulk`, {
        method: 'POST',
        body: form
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');

      const uploadedTracks = data.tracks || [];
      if (uploadedTracks.length > 0) {
        setSongs((current) => [...uploadedTracks, ...current]);
        setSelectedSong(uploadedTracks[0]);
        setUploadStatus(`${uploadedTracks.length} tracks imported into your library.`);
      } else {
        setUploadStatus('Upload complete.');
      }
    } catch (error) {
      setUploadStatus(error.message || 'Bulk upload failed.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar glass-panel">
        <div className="brand-wrap">
          <div className="brand-mark">S</div>
          <div>
            <p className="eyebrow">Studio</p>
            <h1>SONARA</h1>
          </div>
        </div>

        <nav className="nav-menu">
          {navItems.map((item) => (
            <button key={item.label} className={`nav-item ${item.active ? 'active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="section-row">
            <p className="section-label">Your playlists</p>
            <button className="tiny-button">+ New</button>
          </div>

          <div className="playlist-list">
            {samplePlaylists.map((playlist) => (
              <div key={playlist.name} className="playlist-item">
                <span className="playlist-dot" />
                <span>{playlist.name}</span>
                <small>{playlist.tracks}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="mini-profile">
            <div className="avatar">JS</div>
            <div>
              <strong>John S.</strong>
              <small>Profile</small>
            </div>
          </div>
          <button className="settings-button">⚙</button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar glass-panel">
          <div className="topbar-left">
            <button className="round-button">←</button>
            <button className="round-button">→</button>
          </div>

          <label className="search-box" aria-label="Search music">
            <span>⌕</span>
            <input placeholder="Search songs, artists, albums" />
          </label>

          <div className="profile-pill">
            <div className="avatar">JS</div>
            <span>John S.</span>
          </div>
        </header>

        <section className="hero glass-panel">
          <div className="hero-copy">
            <p className="eyebrow accent">Good evening, John</p>
            <h2>What do you want to hear?</h2>
            <p>
              Sonara is shaping a mood for you right now. Let the DJ session pull from your history, your vibe, and the room energy.
            </p>
            <div className="hero-actions">
              <button className="primary-button">Let Sonara set the vibe</button>
              <button className="secondary-button">DJ mode</button>
            </div>
          </div>

          <div className="dj-stage">
            <div className="dj-rings">
              <span className="ring ring-one" />
              <span className="ring ring-two" />
              <span className="ring ring-three" />
              <span className="ring ring-center" />
            </div>
            <div className="dj-panel">
              <span className="tiny-badge">Current Vibe</span>
              <strong>Chill</strong>
              <small>Auto DJ session</small>
            </div>
          </div>
        </section>

        <section className="upload-panel glass-panel">
          <div className="upload-copy">
            <p className="eyebrow accent">Bulk upload</p>
            <h3>Drop in an album folder or ZIP</h3>
          </div>

          <div className="upload-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? 'Uploading...' : 'Choose folder'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              webkitdirectory="true"
              directory="true"
              accept="audio/*,image/*,.zip"
              onChange={handleBulkUpload}
              style={{ display: 'none' }}
            />
          </div>

          {uploadStatus ? <div className="upload-status">{uploadStatus}</div> : null}
        </section>

        <section className="row-block">
          <div className="row-header">
            <h3>Recently Played</h3>
            <button>See all</button>
          </div>

          <div className="recent-grid">
            {recentTracks.map((track) => (
              <button key={track.id} className="recent-card" onClick={() => handleSelectSong({ ...track, album: 'Recent Mix', duration: 210, cover: track.cover })}>
                <img src={track.cover} alt={track.title} />
                <strong>{track.title}</strong>
                <span>{track.artist}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="row-block">
          <div className="row-header">
            <h3>Soundscapes</h3>
            <button>Curated vibes</button>
          </div>

          <div className="soundscape-grid">
            {soundscapes.map((sound) => (
              <button key={sound.name} className={`soundscape-card accent-${sound.accent}`}>
                <div className="soundscape-art" />
                <div className="soundscape-meta">
                  <strong>{sound.name}</strong>
                  <span>{sound.tracks} tracks</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="row-block">
          <div className="row-header">
            <h3>Library</h3>
            <div className="library-tabs">
              <button className="tab active">All Music</button>
              <button className="tab">Folders</button>
              <button className="tab">Playlists</button>
              <button className="tab">Artists</button>
            </div>
          </div>

          <div className="library-table-wrap glass-panel-soft">
            <div className="library-table-header">
              <span>#</span>
              <span>Title</span>
              <span>Artist</span>
              <span>Album</span>
              <span>Time</span>
            </div>

            {(songs.length ? songs : [
              { id: '1', title: 'Midnight Drive', artist: 'Nova Echo', album: 'Afterglow', duration: 205, cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=600&q=80' },
              { id: '2', title: 'Velvet Static', artist: 'Aster Vale', album: 'Night Bloom', duration: 248, cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=600&q=80' },
              { id: '3', title: 'Neon Horizon', artist: 'Prism Avenue', album: 'City Lights', duration: 222, cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80' }
            ]).map((song, index) => (
              <button key={song.id} className={`library-row ${selectedSong?.id === song.id ? 'selected' : ''}`} onClick={() => handleSelectSong(song)}>
                <span className="track-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="track-meta">
                  <img src={song.cover} alt={song.title} />
                  <strong>{song.title}</strong>
                </span>
                <span>{song.artist}</span>
                <span>{song.album}</span>
                <span>{formatTime(song.duration)}</span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <aside className="right-panel glass-panel">
        <div className="panel-label-wrap">
          <p className="section-label">Now Playing</p>
        </div>

        {selectedSong ? (
          <>
            <div className="album-visual">
              <img src={selectedSong.cover} alt={selectedSong.title} />
            </div>

            <div className="track-details">
              <h3>{selectedSong.title}</h3>
              <p>{selectedSong.artist}</p>
            </div>

            <div className="progress-wrap">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${activeTrack * 100}%` }} />
              </div>
              <div className="time-row">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(selectedSong.duration)}</span>
              </div>
            </div>

            <div className="player-controls">
              <button className="small-button">⏮</button>
              <button className="play-button" onClick={() => setIsPlaying((value) => !value)}>
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="small-button">⏭</button>
            </div>

            <div className="context-row">
              <button className="chip">EQ</button>
              <button className="chip">Sleep Timer</button>
              <button className="chip">Change Vibe</button>
            </div>
          </>
        ) : (
          <div className="empty-state">Loading player...</div>
        )}

        <div className="appearance-card">
          <p className="section-label">Appearance Lab</p>
          <div className="preset-list">
            {themePresets.map((preset) => (
              <div key={preset.name} className={`preset-pill ${preset.name === 'Cyber Night' ? 'active' : ''}`}>
                {preset.name}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <footer className="mini-player glass-panel">
        <div className="mini-track">
          <div className="mini-art">
            <img src={selectedSong?.cover || 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=200&q=80'} alt={selectedSong?.title || 'Now playing'} />
          </div>
          <div>
            <strong>{selectedSong?.title || 'Midnight Drive'}</strong>
            <span>{selectedSong?.artist || 'Nova Echo'}</span>
          </div>
        </div>

        <div className="mini-controls">
          <button className="small-button">♡</button>
          <button className="small-button">⏮</button>
          <button className="play-button small-player" onClick={() => setIsPlaying((value) => !value)}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="small-button">⏭</button>
          <button className="small-button">↻</button>
        </div>

        <div className="mini-progress">
          <span>{formatTime(progress)}</span>
          <div className="progress-bar mini"><div className="progress-fill" style={{ width: `${activeTrack * 100}%` }} /></div>
          <span>{selectedSong ? formatTime(selectedSong.duration) : '3:25'}</span>
        </div>
      </footer>
    </div>
  );
}
