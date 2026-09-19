import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'all-music', label: 'Discover' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'upload', label: 'Upload' }
];

const defaultPlaylists = [
  { id: 'daily-mix', name: 'Daily Mix', accent: 'linear-gradient(135deg, #ff5ad9, #7e68ff)' },
  { id: 'focus-flow', name: 'Focus Flow', accent: 'linear-gradient(135deg, #59d8ff, #7e68ff)' },
  { id: 'late-night', name: 'Late Night', accent: 'linear-gradient(135deg, #ff9a4d, #ff5ad9)' },
  { id: 'uploads', name: 'Uploads', accent: 'linear-gradient(135deg, #84f1d4, #59d8ff)' }
];

const starterTracks = [
  { id: 'track-1', title: 'Midnight Drive', artist: 'Nova Echo', album: 'Afterglow', duration: '3:25', cover: '#ff5ad9' },
  { id: 'track-2', title: 'Velvet Static', artist: 'Aster Vale', album: 'Night Bloom', duration: '4:08', cover: '#7e68ff' },
  { id: 'track-3', title: 'Neon Horizon', artist: 'Prism Avenue', album: 'City Lights', duration: '3:42', cover: '#59d8ff' },
  { id: 'track-4', title: 'Afterhours', artist: 'Mira Sol', album: 'Dusk Signals', duration: '4:21', cover: '#84f1d4' },
  { id: 'track-5', title: 'Night Shift', artist: 'Kora Lane', album: 'Soft Voltage', duration: '3:57', cover: '#ff9a4d' }
];

const playlistTracks = {
  'daily-mix': [
    { id: 'p1', title: 'Bloom', artist: 'Aster Vale', album: 'Night Bloom', time: '3:12' },
    { id: 'p2', title: 'Run It Back', artist: 'Nova Echo', album: 'Afterglow', time: '2:58' },
    { id: 'p3', title: 'Signal Fade', artist: 'Prism Avenue', album: 'City Lights', time: '4:14' }
  ],
  'focus-flow': [
    { id: 'f1', title: 'Glass Memo', artist: 'Kora Lane', album: 'Soft Voltage', time: '3:36' },
    { id: 'f2', title: 'Clear Drift', artist: 'Mira Sol', album: 'Dusk Signals', time: '4:02' },
    { id: 'f3', title: 'Still Blue', artist: 'Nova Echo', album: 'Afterglow', time: '3:49' }
  ],
  'late-night': [
    { id: 'l1', title: 'Slow Arcade', artist: 'Prism Avenue', album: 'City Lights', time: '4:27' },
    { id: 'l2', title: 'Velvet Echo', artist: 'Aster Vale', album: 'Night Bloom', time: '3:21' },
    { id: 'l3', title: 'Sunset Static', artist: 'Mira Sol', album: 'Dusk Signals', time: '4:09' }
  ],
  uploads: [
    { id: 'u1', title: 'Fresh Upload', artist: 'Your library', album: 'New batch', time: '3:18' },
    { id: 'u2', title: 'Folder Import', artist: 'Your library', album: 'Bulk drop', time: '4:01' },
    { id: 'u3', title: 'Album Artwork', artist: 'Your library', album: 'Auto-detected', time: '3:45' }
  ]
};

const pageTitles = {
  home: 'Home',
  library: 'Library',
  'all-music': 'Discover',
  playlists: 'Playlists',
  favorites: 'Favorites',
  upload: 'Upload Music'
};

const pageSubtitles = {
  home: 'Your daily mix is ready to roll.',
  library: 'Everything you have saved and collected in one place.',
  'all-music': 'Browse fresh tracks and find your next obsession.',
  playlists: 'Curated collections built around your sound and mood.',
  favorites: 'The songs you keep returning to.',
  upload: 'Import new tracks, albums, and whole folders in one pass.'
};

export default function App() {
  const [activeView, setActiveView] = useState('home');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('daily-mix');
  const [audioFileName, setAudioFileName] = useState('Select audio files or folder');
  const [uploadMessage, setUploadMessage] = useState('');
  const [selectedAudioFiles, setSelectedAudioFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [recentUploads, setRecentUploads] = useState([]);
  const audioInputRef = useRef(null);

  const fetchCatalog = async () => {
    try {
      const response = await fetch(`${apiBase}/catalog`);
      if (!response.ok) return;

      const payload = await response.json();
      const songs = Array.isArray(payload?.songs) ? payload.songs : Array.isArray(payload) ? payload : [];
      setCatalog(songs);
      setRecentUploads(songs.slice(0, 4));
    } catch (error) {
      console.error('Unable to load catalog', error);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const allTracks = useMemo(() => {
    const bucketTracks = catalog.map((item, index) => ({
      id: item.id || `catalog-${index}`,
      title: item.title || 'Untitled track',
      artist: item.artist || 'Unknown artist',
      album: item.album || 'Single',
      duration: item.duration ? `${Math.max(1, Math.round(item.duration / 60))}:${String(Math.round(item.duration % 60)).padStart(2, '0')}` : '3:18',
      cover: item.cover || '#59d8ff'
    }));

    return [...starterTracks, ...bucketTracks];
  }, [catalog]);

  const featuredTracks = allTracks.slice(0, 3);
  const recentLibrary = allTracks.slice(0, 4);
  const favoriteTracks = allTracks.slice(2, 6);
  const selectedPlaylist = defaultPlaylists.find((playlist) => playlist.id === selectedPlaylistId) || defaultPlaylists[0];
  const activePlaylistTracks = playlistTracks[selectedPlaylistId] || playlistTracks['daily-mix'];

  const isAudioFileCandidate = (file) => {
    const candidate = (file?.name || '').toLowerCase();
    const mimeType = (file?.type || '').toLowerCase();
    const normalized = candidate.split('\\').join('/');

    return mimeType.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma)$/i.test(normalized);
  };

  const updateAudioSelection = (files) => {
    const validAudioFiles = Array.from(files || []).filter((file) => {
      if (!file) return false;
      if (isAudioFileCandidate(file)) return true;

      const relativePath = (file.webkitRelativePath || file.name || '').toLowerCase();
      return /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma)$/i.test(relativePath);
    });

    if (!validAudioFiles.length) {
      setUploadMessage('No supported audio files were selected.');
      setSelectedAudioFiles([]);
      setAudioFileName('Select audio files or folder');
      return;
    }

    setSelectedAudioFiles(validAudioFiles);
    setAudioFileName(validAudioFiles.length > 1 ? `${validAudioFiles.length} tracks selected` : validAudioFiles[0].name);
    setUploadMessage(validAudioFiles.length > 1 ? `${validAudioFiles.length} tracks ready for bulk import.` : 'Audio ready for upload.');
  };

  const clearUploadSelection = () => {
    setSelectedAudioFiles([]);
    setAudioFileName('Select audio files or folder');
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    if (event.target === audioInputRef.current) updateAudioSelection(files);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const droppedFiles = Array.from(event.dataTransfer?.files || []);
    if (!droppedFiles.length) return;
    updateAudioSelection(droppedFiles);
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!selectedAudioFiles.length) {
      setUploadMessage('Choose audio files or a folder before uploading.');
      return;
    }

    const formData = new FormData();
    selectedAudioFiles.forEach((file) => {
      formData.append('files', file, file.webkitRelativePath || file.name);
    });

    setIsUploading(true);
    setUploadMessage('Uploading to Sonara...');

    try {
      const response = await fetch(`${apiBase}/uploads/bulk`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');

      const uploadedTracks = Array.isArray(data?.tracks) ? data.tracks : [];
      if (uploadedTracks.length) setRecentUploads(uploadedTracks);

      await fetchCatalog();
      setUploadMessage(`${data.tracks?.length || selectedAudioFiles.length} track${data.tracks?.length === 1 ? '' : 's'} uploaded successfully.`);
      clearUploadSelection();
    } catch (error) {
      setUploadMessage(error.message || 'Unable to upload right now.');
    } finally {
      setIsUploading(false);
    }
  };

  const renderHome = () => (
    <>
      <div className="hero-row section-panel">
        <div className="hero-copy">
          <h2>Daily Mix</h2>
          <p>Fresh tracks for your current mood: warm synths, low-lit drums, and midnight energy.</p>
        </div>
        <button type="button" className="hero-button" onClick={() => setActiveView('all-music')}>Play now</button>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <span>Saved</span>
          <strong>4.8k</strong>
        </div>
        <div className="stat-card">
          <span>Listening</span>
          <strong>18h</strong>
        </div>
        <div className="stat-card">
          <span>New</span>
          <strong>29</strong>
        </div>
      </div>

      <div className="section-panel">
        <div className="section-header">
          <h3>Trending today</h3>
          <button type="button" onClick={() => setActiveView('all-music')}>See all</button>
        </div>
        <div className="feature-grid">
          {featuredTracks.map((track) => (
            <div key={track.id} className="feature-card" style={{ background: `linear-gradient(135deg, ${track.cover}, rgba(10,18,24,0.88))` }}>
              {track.title}
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const renderLibrary = () => (
    <div className="section-panel">
      <div className="section-header">
        <h3>Your library</h3>
        <button type="button" onClick={() => setActiveView('playlists')}>Manage</button>
      </div>
      <div className="track-list">
        {recentLibrary.map((track) => (
          <div key={track.id} className="track-row">
            <div className="track-cover" style={{ background: track.cover }} />
            <div className="track-copy">
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </div>
            <span className="track-meta-small">{track.album}</span>
            <span className="track-meta-small">{track.duration}</span>
            <button type="button" className="play-button">▶</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDiscover = () => (
    <div className="section-panel">
      <div className="section-header">
        <h3>Explore</h3>
        <button type="button" onClick={() => setActiveView('favorites')}>Your taste</button>
      </div>
      <div className="track-list">
        {allTracks.slice(0, 6).map((track) => (
          <div key={track.id} className="track-row">
            <div className="track-cover" style={{ background: track.cover }} />
            <div className="track-copy">
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </div>
            <span className="track-meta-small">{track.album}</span>
            <span className="track-meta-small">{track.duration}</span>
            <button type="button" className="play-button">▶</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFavorites = () => (
    <div className="section-panel">
      <div className="section-header">
        <h3>Favorites</h3>
        <button type="button" onClick={() => setActiveView('home')}>Back home</button>
      </div>
      <div className="track-list">
        {favoriteTracks.map((track) => (
          <div key={track.id} className="track-row">
            <div className="track-cover" style={{ background: track.cover }} />
            <div className="track-copy">
              <strong>{track.title}</strong>
              <span>{track.artist}</span>
            </div>
            <span className="track-meta-small">{track.album}</span>
            <span className="track-meta-small">{track.duration}</span>
            <button type="button" className="play-button">♥</button>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPlaylists = () => (
    <div className="playlist-layout">
      <aside className="playlist-sidebar">
        <h3>Playlists</h3>
        <div className="playlist-list-compact">
          {defaultPlaylists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={`playlist-list-item ${selectedPlaylistId === playlist.id ? 'active' : ''}`}
              onClick={() => setSelectedPlaylistId(playlist.id)}
            >
              <span className="playlist-dot" style={{ background: playlist.accent }} />
              {playlist.name}
            </button>
          ))}
        </div>
      </aside>

      <div className="playlist-main">
        <div className="playlist-header">
          <div className="playlist-header-card">
            <div className="playlist-cover" style={{ background: selectedPlaylist.accent }} />
            <div>
              <h4>{selectedPlaylist.name}</h4>
              <p>{activePlaylistTracks.length} tracks • curated</p>
            </div>
          </div>
          <div className="playlist-actions">
            <button type="button" className="pill-button">Shuffle</button>
            <button type="button" className="pill-button">Play</button>
          </div>
        </div>

        <div className="track-table">
          <div className="table-row header">
            <span>#</span>
            <span>Title</span>
            <span>Album</span>
            <span>Time</span>
            <span> </span>
          </div>

          {activePlaylistTracks.map((track, index) => (
            <div key={track.id} className="table-row">
              <span className="track-index">{index + 1}</span>
              <div>
                <div className="track-name">{track.title}</div>
                <div className="track-meta-small">{track.artist}</div>
              </div>
              <span className="track-meta-small">{track.album}</span>
              <span className="track-time">{track.time}</span>
              <button type="button" className="play-button">▶</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderUpload = () => (
    <>
      <div className="upload-column">
        <div
          className="dropzone"
          onClick={() => audioInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
        >
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.m4b,.m4r"
            multiple
            webkitdirectory=""
            directory=""
            onChange={handleFiles}
            hidden
          />
          <div className="drop-icon">↑</div>
          <div className="drop-text">
            <span>Drop your music here</span>
            <small>or click to browse</small>
          </div>
          <div className="drop-meta">MP3, M4A, FLAC, WAV, OGG • folder upload supported</div>
        </div>

        <div className="tab-switcher" role="tablist" aria-label="Upload type tabs">
          <button type="button" className="active">Track</button>
          <button type="button">Album</button>
          <button type="button">Artist</button>
        </div>

        <div className="upload-simple-summary">
          <p>Album art is auto-detected from your files. No manual metadata is required for the upload flow.</p>
        </div>

        <div className="audio-upload-row">
          <div className="audio-file-picker">
            <span className="mini-note">Audio files</span>
            <button type="button" onClick={() => audioInputRef.current?.click()}>
              <span className="music-icon">♫</span>
              {audioFileName}
            </button>
          </div>
        </div>

        {uploadMessage && <div className="upload-toast">{uploadMessage}</div>}

        <button type="button" className="primary-upload-button" onClick={handleUpload} disabled={isUploading}>
          <span>↑</span>
          {isUploading ? 'Uploading...' : 'Upload Track(s)'}
        </button>
      </div>

      <aside className="right-panel">
        <div className="info-box">
          <h2>Upload guidelines</h2>
          <ul>
            <li>Drop one track or a full album folder.</li>
            <li>Artwork is auto-detected from the files you upload.</li>
            <li>Bulk import keeps metadata extraction and catalog updates simple.</li>
          </ul>
        </div>

        <div className="info-box">
          <h2>Recent uploads</h2>
          {recentUploads.length ? (
            recentUploads.map((track, index) => (
              <div key={track.id || `${track.title}-${index}`} className="upload-story">
                <div className="row-cover" style={{ background: track.cover || '#59d8ff' }} />
                <div>
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="empty-state-text">No recent uploads yet.</p>
          )}
        </div>
      </aside>
    </>
  );

  const pageContent = {
    home: renderHome(),
    library: renderLibrary(),
    'all-music': renderDiscover(),
    playlists: renderPlaylists(),
    favorites: renderFavorites(),
    upload: renderUpload()
  };

  return (
    <div className="sonara-app-shell">
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-wave" />
            <span>Sonara</span>
          </div>

          <nav className="nav-stack" aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                onClick={() => setActiveView(item.id)}
              >
                <span className="nav-icon" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-section">
            <p>Your playlists</p>
            <div className="playlist-list">
              {defaultPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  className={`playlist-pill ${selectedPlaylistId === playlist.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedPlaylistId(playlist.id);
                    setActiveView('playlists');
                  }}
                >
                  <span className="playlist-dot" style={{ background: playlist.accent }} />
                  {playlist.name}
                </button>
              ))}
            </div>
          </div>

          <div className="player-card-fixed">
            <div className="mini-cover" />
            <div className="mini-meta">
              <strong>Dimension</strong>
              <span>JAE • Skepta • Rema</span>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-topline">
              <span>Sonara</span>
              <button type="button" onClick={() => setActiveView('upload')}>Upload</button>
            </div>
            <h1>{pageTitles[activeView]}</h1>
            <p>{pageSubtitles[activeView]}</p>
          </header>

          <section className="content-grid">{pageContent[activeView]}</section>
        </main>
      </div>
    </div>
  );
}
