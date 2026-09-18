import { useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const navItems = [
  { label: 'Home', active: false },
  { label: 'Library', active: false },
  { label: 'All Music', active: true },
  { label: 'Lab', active: false },
  { label: 'Playlists', active: false },
  { label: 'Favorites', active: false },
  { label: 'John\'s playlist', active: false }
];

const adminItems = [
  { label: 'Dashboard', active: false },
  { label: 'Songs', active: false },
  { label: 'Albums', active: false },
  { label: 'Artists', active: false },
  { label: 'Upload', active: true },
  { label: 'Users', active: false },
  { label: 'Settings', active: false }
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

export default function App() {
  const [activeTab, setActiveTab] = useState('track');
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
    setAudioFileName(
      validAudioFiles.length > 1
        ? `${validAudioFiles.length} tracks selected`
        : validAudioFiles[0].name
    );
    setUploadMessage(
      validAudioFiles.length > 1
        ? `${validAudioFiles.length} tracks ready for bulk import.`
        : 'Audio ready for upload.'
    );
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

  return (
    <div className="sonara-app-shell">
      <div className="browser-window">
        <div className="browser-toolbar">
          <div className="traffic-lights">
            <span className="light red" />
            <span className="light yellow" />
            <span className="light green" />
          </div>

          <div className="address-pill">
            <span className="domain-dot" />
            <span>sonara.app</span>
          </div>

          <div className="toolbar-actions">
            <span className="toolbar-icon">⌕</span>
            <span className="toolbar-icon">◌</span>
            <span className="toolbar-icon">⎈</span>
          </div>
        </div>

        <div className="app-layout">
          <aside className="sidebar">
            <div className="sidebar-brand">
              <span className="brand-wave" />
              <span>Sonara</span>
            </div>

            <nav className="nav-stack" aria-label="Main navigation">
              {navItems.map((item) => (
                <button key={item.label} className={`nav-item ${item.active ? 'active' : ''}`} type="button">
                  <span className="nav-icon" />
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="sidebar-section">
              <p>Admin</p>
              <div className="nav-stack small-stack">
                {adminItems.map((item) => (
                  <button key={item.label} className={`nav-item ${item.active ? 'active' : ''}`} type="button">
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
                <button type="button">Upload</button>
              </div>
              <h1>Upload Music</h1>
              <p>Add new songs, albums and artists to your Sonara collection.</p>
            </header>

            <section className="content-grid">
              <div className="upload-column">
                <div className="dropzone" onClick={() => audioInputRef.current?.click()}>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.flac,.m4a,.aac"
                    multiple
                    onChange={handleFiles}
                    webkitdirectory=""
                    directory=""
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
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFiles}
                      hidden
                    />
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
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
