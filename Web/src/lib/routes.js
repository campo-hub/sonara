const validLibraryTabs = new Set(['songs', 'albums', 'artists']);

export function parseHashRoute(hash = '') {
  const raw = String(hash || '').replace(/^#/, '') || '/home';
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const params = new URLSearchParams(queryPart);
  const first = segments[0] || 'home';

  if (first === 'all-music') {
    return { view: 'library', libraryTab: 'songs', query: params.get('q') || '', hash: '#/library/songs' };
  }
  if (first === 'library') {
    const libraryTab = validLibraryTabs.has(segments[1]) ? segments[1] : 'songs';
    return { view: 'library', libraryTab, query: params.get('q') || '', hash: `#/library/${libraryTab}${params.has('q') ? `?q=${encodeURIComponent(params.get('q'))}` : ''}` };
  }
  if (first === 'playlists') {
    const genre = segments[1] === 'genre' ? segments[2] || '' : '';
    const playlistId = segments[1] && segments[1] !== 'genre' ? segments[1] : '';
    return {
      view: 'playlists',
      genre,
      playlistId,
      hash: genre ? `#/playlists/genre/${encodeURIComponent(genre)}` : playlistId ? `#/playlists/${encodeURIComponent(playlistId)}` : '#/playlists'
    };
  }
  if (['home', 'favorites', 'lab', 'admin', 'upload'].includes(first)) {
    return { view: first, hash: `#/${first}` };
  }
  return { view: 'home', hash: '#/home' };
}

export function createRouteHash(view, { libraryTab = 'songs', query = '', genre = '', playlistId = '' } = {}) {
  if (view === 'all-music') view = 'library';
  if (view === 'library') {
    const tab = validLibraryTabs.has(libraryTab) ? libraryTab : 'songs';
    const search = String(query || '').trim();
    return `#/library/${tab}${search ? `?q=${encodeURIComponent(search)}` : ''}`;
  }
  if (view === 'playlists' && genre) return `#/playlists/genre/${encodeURIComponent(genre)}`;
  if (view === 'playlists' && playlistId) return `#/playlists/${encodeURIComponent(playlistId)}`;
  return `#/${['home', 'playlists', 'favorites', 'lab', 'admin', 'upload'].includes(view) ? view : 'home'}`;
}