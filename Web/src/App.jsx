import { useEffect, useMemo, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const sidebarItems = [
  'Home',
  'Search',
  'Your Library',
  'Discover',
  'Artists',
  'Albums',
  'Playlists'
];

const samplePlaylists = [
  { name: 'Night Drive', tracks: 24 },
  { name: 'Focus Flow', tracks: 18 },
  { name: 'After Hours', tracks: 31 },
  { name: 'Mood Booster', tracks: 12 }
];

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const [songs, setSongs] = useState([]);
  const [featured, setFeatured] = useState({ curated: [], trending: [], mood: '' });
  const [selectedSong, setSelectedSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
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
    if (!selectedSong) return null;
    return selectedSong.duration ? Math.min(progress / selectedSong.duration, 1) : 0;
  }, [progress, selectedSong]);

  const handleSelectSong = (song) => {
    setSelectedSong(song);
    setProgress(0);
    setIsPlaying(true);
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
          {sidebarItems.map((item, index) => (
            <button key={item} className={`nav-item ${index === 0 ? 'active' : ''}`}>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <p className="section-label">PLAYLISTS</p>
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
      </aside>

      <main className="main-panel">
        <header className="topbar glass-panel">
          <div className="topbar-left">
            <button className="round-button">←</button>
            <button className="round-button">→</button>
          </div>

          <div className="search-box">
            <span>⌕</span>
            <input placeholder="Search for songs, artists, albums" />
          </div>

          <div className="profile-pill">
            <div className="avatar">JS</div>
            <span>Jamie S.</span>
          </div>
        </header>

        <section className="hero glass-panel">
          <div className="hero-copy">
            <p className="eyebrow accent">Curated for tonight</p>
            <h2>{featured.mood || 'Late-night glow'}</h2>
            <p>
              Discover smooth electronic sets, cinematic pop, and deep-focus cuts curated for your studio flow.
            </p>
            <div className="hero-actions">
              <button className="primary-button">Play mix</button>
              <button className="secondary-button">Follow</button>
            </div>
          </div>

          <div className="hero-art">
            <div className="art-orb orb-one" />
            <div className="art-orb orb-two" />
            <div className="hero-disc-wrap">
              <div className="hero-disc" />
            </div>
          </div>
        </section>

        <section className="row-block">
          <div className="row-header">
            <h3>Trending now</h3>
            <button>See all</button>
          </div>

          <div className="song-grid">
            {featured.trending.map((song) => (
              <button key={song.id} className="track-card" onClick={() => handleSelectSong(song)}>
                <img src={song.cover} alt={song.title} />
                <div>
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="row-block">
          <div className="row-header">
            <h3>Browse all</h3>
            <button>Fresh picks</button>
          </div>

          <div className="library-list">
            {songs.map((song) => (
              <div key={song.id} className={`library-row ${selectedSong?.id === song.id ? 'selected' : ''}`} onClick={() => handleSelectSong(song)}>
                <div className="track-rank">0{song.id}</div>
                <div className="track-meta">
                  <img src={song.cover} alt={song.title} />
                  <div>
                    <strong>{song.title}</strong>
                    <span>{song.artist}</span>
                  </div>
                </div>
                <span className="album-text">{song.album}</span>
                <span>{formatTime(song.duration)}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <aside className="right-panel glass-panel">
        <div className="now-playing-header">
          <span className="section-label">NOW PLAYING</span>
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
          </>
        ) : (
          <div className="empty-state">Loading player...</div>
        )}
      </aside>
    </div>
  );
}
