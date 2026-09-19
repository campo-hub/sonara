import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'upload', label: 'Upload' }
];

const pageTitles = {
  home: 'Home',
  upload: 'Upload Music'
};

const pageSubtitles = {
  home: 'Your daily mix is ready to roll.',
  upload: 'Import new tracks, albums, and whole folders in one pass.'
};

export default function App() {
  const [activeView, setActiveView] = useState('home');
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [audioFileName, setAudioFileName] = useState('Select audio files or folder');
  const [uploadMessage, setUploadMessage] = useState('');
  const [selectedAudioFiles, setSelectedAudioFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [recentUploads, setRecentUploads] = useState([]);
  const [catalogMessage, setCatalogMessage] = useState('Loading your library...');
  const audioInputRef = useRef(null);

  const fetchCatalog = async () => {
    try {
      const response = await fetch(`${apiBase}/catalog`);
      if (!response.ok) {
        throw new Error(`Catalog request failed (${response.status})`);
      }

      const payload = await response.json();
      const songs = Array.isArray(payload?.songs) ? payload.songs : Array.isArray(payload) ? payload : [];
      setCatalog(songs);
      setRecentUploads(songs.slice(0, 4));
      setCatalogMessage(songs.length ? '' : 'No uploaded music yet. Use Upload to add your first track.');
    } catch (error) {
      console.error('Unable to load catalog', error);
      setCatalogMessage('Unable to load the live library. Check the backend connection and try again.');
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
      cover: item.cover || '#59d8ff',
      audioUrl: item.audioUrl || ''
    }));

    return bucketTracks;
  }, [catalog]);

  useEffect(() => {
    if (!allTracks.length) return;

    if (!selectedTrack) {
      setSelectedTrack(allTracks[0]);
      return;
    }

    const stillExists = allTracks.some((track) => track.id === selectedTrack.id);
    if (!stillExists) {
      setSelectedTrack(allTracks[0]);
    }
  }, [allTracks, selectedTrack]);

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
      if (uploadedTracks.length) {
        setRecentUploads(uploadedTracks);
      }

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
          <p>Fresh tracks for your current mood, ready to test and play live.</p>
        </div>
        <button type="button" className="hero-button" onClick={() => setActiveView('upload')}>Upload</button>
      </div>

      <div className="section-panel player-panel">
        <div className="now-playing">
          <div className="player-cover" style={{ background: selectedTrack?.cover || '#59d8ff' }} />
          <div>
            <span className="eyebrow">Now playing</span>
            <h3>{selectedTrack?.title || 'Pick a track'}</h3>
            <p>{selectedTrack?.artist || 'No track selected'}</p>
          </div>
        </div>
        <audio controls src={selectedTrack?.audioUrl || undefined} className="audio-player" />
      </div>

      <div className="section-panel">
        <div className="section-header">
          <h3>Library</h3>
          <button type="button" onClick={() => setActiveView('upload')}>Add music</button>
        </div>
        <div className="track-list">
          {allTracks.length ? allTracks.map((track) => (
            <button
              type="button"
              key={track.id}
              className={`track-row ${selectedTrack?.id === track.id ? 'selected' : ''}`}
              onClick={() => setSelectedTrack(track)}
            >
              <div className="track-cover" style={{ background: track.cover }} />
              <div className="track-copy">
                <strong>{track.title}</strong>
                <span>{track.artist}</span>
              </div>
              <span className="track-meta-small">{track.album}</span>
              <span className="track-meta-small">{track.duration}</span>
              <span className="play-button">▶</span>
            </button>
          )) : <p className="empty-state-text">{catalogMessage}</p>}
        </div>
      </div>
    </>
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
        </div>

        <div className="upload-simple-summary">
          <p>Upload a single track or an entire folder, then come back to Home to test playback.</p>
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
          <h2>Upload notes</h2>
          <ul>
            <li>Drop one file or an entire folder.</li>
            <li>Files are stored via the connected backend.</li>
            <li>Once uploaded, the new tracks appear on Home for playback testing.</li>
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

          <div className="player-card-fixed">
            <div className="mini-cover" style={{ background: selectedTrack?.cover || '#59d8ff' }} />
            <div className="mini-meta">
              <strong>{selectedTrack?.title || 'Home'}</strong>
              <span>{selectedTrack?.artist || 'Ready to play'}</span>
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
