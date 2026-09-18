import { useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'all-music', label: 'All Music' },
  { id: 'lab', label: 'Lab' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'playlist', label: 'John\'s playlist' }
];

const adminItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'upload', label: 'Upload' },
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' }
];

const uploads = [
  { title: 'Dimension (feat. Skepta & Rema)', artist: 'JAE, Skepta, Rema', duration: '3:54', status: 'Uploaded' },
  { title: 'Good Days', artist: 'SZA', duration: '4:38', status: 'Uploaded' },
  { title: 'Kesho', artist: 'Bensoul', duration: '3:20', status: 'Uploading...', progress: 72 },
  { title: 'Nimkeuzoea', artist: 'Rosa Ree', duration: '3:45', status: 'Queued' }
];

const guideItems = [
  'Supported formats: MP3, M4A, FLAC, WAV',
  'Maximum file size: 100 MB per file',
  'Use high-quality audio (320 kbps recommended)',
  'Cover art should be square (1:1 ratio)',
  'Make sure you have the rights to upload this content'
];

const metadataRows = [
  ['Title', 'Language'],
  ['Artist', 'Cover Art'],
  ['Album', 'Lyrics (optional)'],
  ['Genre', 'ISRC (optional)'],
  ['Year', 'Composer (optional)'],
  ['Duration', 'Label (optional)']
];

const pageTitles = {
  home: 'Home',
  library: 'Library',
  'all-music': 'All Music',
  lab: 'Lab',
  playlists: 'Playlists',
  favorites: 'Favorites',
  playlist: 'John\'s playlist',
  dashboard: 'Dashboard',
  songs: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
  upload: 'Upload Music',
  users: 'Users',
  settings: 'Settings'
};

const appPageContent = {
  home: { subtitle: 'Your daily mix is ready to roll.', cards: ['Recently played', 'Suggested for you', 'Top releases'] },
  library: { subtitle: 'Everything you have saved and collected in one place.', cards: ['Saved tracks', 'Collections', 'Albums'] },
  'all-music': { subtitle: 'Browse your full library without losing the vibe.', cards: ['All tracks', 'Artists', 'Genres'] },
  lab: { subtitle: 'Experimental tools and sonic analysis for creators.', cards: ['Mix analyzer', 'Waveforms', 'Mood engine'] },
  playlists: { subtitle: 'Curated collections built around your style.', cards: ['Chill', 'Late nights', 'Focus'] },
  favorites: { subtitle: 'The tracks you keep coming back to.', cards: ['Loved tracks', 'Replays', 'Saved artists'] },
  playlist: { subtitle: 'A personal playlist tuned for your sessions.', cards: ['Tracks', 'Highlights', 'Energy curve'] },
  dashboard: { subtitle: 'A quick overview of your uploader and music health.', cards: ['Uploads today', 'Monthly listeners', 'Active albums'] },
  songs: { subtitle: 'Manage the catalog and quick edits for each track.', cards: ['Published', 'Drafts', 'Needs review'] },
  albums: { subtitle: 'Albums and collections ready for publishing.', cards: ['Featured', 'New', 'Archived'] },
  artists: { subtitle: 'Artist profiles and release activity.', cards: ['Featured', 'A–Z', 'Recently updated'] },
  upload: { subtitle: 'Add new songs, albums and artists to your Sonara collection.', cards: ['Upload queue', 'Metadata', 'Delivery status'] },
  users: { subtitle: 'Manage access, roles, and listening activity.', cards: ['Active users', 'Editors', 'Requests'] },
  settings: { subtitle: 'Publishing, storage, and platform preferences.', cards: ['General', 'Storage', 'Integrations'] }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('track');
  const [activeSection, setActiveSection] = useState('upload');
  const [audioFileName, setAudioFileName] = useState('Select audio files or folder');
  const [coverName, setCoverName] = useState('Upload cover art');
  const [uploadMessage, setUploadMessage] = useState('');
  const [selectedAudioFiles, setSelectedAudioFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const audioInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const updateAudioSelection = (files) => {
    const validAudioFiles = Array.from(files || []).filter((file) => {
      const candidate = file.name || '';
      return file.type.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac)$/i.test(candidate);
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

  const handleFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    if (event.target === audioInputRef.current) {
      updateAudioSelection(files);
    }

    if (event.target === coverInputRef.current) {
      const file = files[0];
      setCoverName(file?.name || 'Upload cover art');
      setUploadMessage('Cover art ready for upload.');
    }
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

    const coverFile = coverInputRef.current?.files?.[0];
    if (coverFile) {
      formData.append('cover', coverFile, coverFile.name);
    }

    setIsUploading(true);
    setUploadMessage('Uploading to Sonara...');

    try {
      const response = await fetch(`${apiBase}/uploads/bulk`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');
      setUploadMessage(`${data.tracks?.length || selectedAudioFiles.length} track${data.tracks?.length === 1 ? '' : 's'} queued for import.`);
      setSelectedAudioFiles([]);
      setAudioFileName('Select audio files or folder');
    } catch (error) {
      setUploadMessage(error.message || 'Unable to upload right now.');
    } finally {
      setIsUploading(false);
    }
  };

  const renderPageContent = () => {
    const pageInfo = appPageContent[activeSection] || appPageContent.upload;

    if (activeSection !== 'upload') {
      return (
        <div className="placeholder-page">
          <div className="placeholder-head">
            <h2>{pageTitles[activeSection] || 'Page'}</h2>
            <span>{pageInfo.subtitle}</span>
          </div>

          <div className="placeholder-grid">
            {pageInfo.cards.map((card) => (
              <div key={card} className="placeholder-card">
                <span>{card}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="upload-column">
          <div className="dropzone" onClick={() => audioInputRef.current?.click()}>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.m4a,.aac"
              multiple
              onChange={handleFiles}
              hidden
            />
            <div className="drop-icon">↑</div>
            <div className="drop-text">
              <span>Drag and drop your files here</span>
              <small>or click to browse</small>
            </div>
            <div className="drop-meta">MP3, M4A, FLAC, WAV · Max 100 MB per file</div>
          </div>

          <div className="tab-switcher" role="tablist" aria-label="Upload type tabs">
            <button type="button" className={activeTab === 'track' ? 'active' : ''} onClick={() => setActiveTab('track')}>Track</button>
            <button type="button" className={activeTab === 'album' ? 'active' : ''} onClick={() => setActiveTab('album')}>Album</button>
            <button type="button" className={activeTab === 'artist' ? 'active' : ''} onClick={() => setActiveTab('artist')}>Artist</button>
          </div>

          <div className="form-grid">
            <label className="field-block">
              <span>Song title *</span>
              <input type="text" placeholder="e.g. Dimension" />
            </label>

            <label className="field-block">
              <span>Artist *</span>
              <input type="text" placeholder="e.g. JAE" />
            </label>

            <div className="art-block">
              <button type="button" className="cover-button" onClick={() => coverInputRef.current?.click()}>
                <span className="cover-icon">◧</span>
                <span>{coverName}</span>
              </button>
              <input ref={coverInputRef} type="file" accept="image/*" onChange={handleFiles} hidden />
            </div>

            <label className="field-block">
              <span>Genre</span>
              <input type="text" placeholder="e.g. Dimension" />
            </label>

            <label className="field-block">
              <span>Year</span>
              <input type="text" placeholder="e.g. 2024" />
            </label>

            <label className="field-block">
              <span>Duration (optional)</span>
              <input type="text" placeholder="e.g. 3:54" />
            </label>

            <label className="field-block">
              <span>Language</span>
              <select defaultValue="">
                <option value="" disabled>Select language</option>
                <option>English</option>
                <option>Spanish</option>
                <option>French</option>
              </select>
            </label>
          </div>

          <div className="audio-upload-row">
            <div className="audio-file-picker">
              <span className="mini-note">Audio file *</span>
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
          <div className="info-box guide-box">
            <h2>Upload Guidelines</h2>
            <ul>
              {guideItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="info-box recent-box">
            <div className="box-header">
              <h2>Recent Uploads</h2>
              <button type="button">View all</button>
            </div>

            {uploads.map((song) => (
              <div key={song.title} className="upload-row">
                <div className="row-cover" />
                <div className="row-meta">
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </div>
                <div className="row-status">
                  <span>{song.duration}</span>
                  <em>{song.status}</em>
                </div>
              </div>
            ))}
          </div>

          <div className="info-box metadata-box">
            <h2>Supported Metadata</h2>
            <div className="metadata-grid">
              {metadataRows.map((row) => (
                <div key={row.join('-')} className="metadata-row">
                  {row.map((cell) => (
                    <span key={cell}>{cell}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </>
    );
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
                className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="nav-icon" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-section">
            <p>Admin</p>
            <div className="nav-stack small-stack">
              {adminItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="nav-icon" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="player-card-fixed">
            <div className="mini-cover" />
            <div className="mini-meta">
              <strong>Dimension (feat. Skepta &amp; Rema)</strong>
              <span>JAE, Skepta, Rema</span>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="workspace-header">
            <div className="workspace-topline">
              <span>Admin</span>
              <button type="button" onClick={() => setActiveSection('upload')}>Upload</button>
            </div>
            <h1>{pageTitles[activeSection] || 'Upload Music'}</h1>
            <p>{appPageContent[activeSection]?.subtitle || 'Add new songs, albums and artists to your Sonara collection.'}</p>
          </header>

          <section className="content-grid">{renderPageContent()}</section>
        </main>
      </div>
    </div>
  );
}
