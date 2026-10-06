const emailPrefix = (email) => String(email || '').split('@')[0] || '';

export function resolveUploaderIdentity(track = {}, profile = null, firebaseUser = null) {
  const uploadedBy = String(track.uploadedBy || '').trim();
  const uid = uploadedBy && !uploadedBy.includes('@') && !['anonymous', 'community'].includes(uploadedBy.toLowerCase())
    ? uploadedBy
    : '';
  const email = String(profile?.email || firebaseUser?.email || track.uploadedByEmail || (uploadedBy.includes('@') ? uploadedBy : '')).trim().toLowerCase();
  const username = String(profile?.username || '').trim();
  const displayName = username
    || emailPrefix(email)
    || String(track.uploadedByName || '').trim()
    || (uid ? 'Unknown user' : 'Community');

  return { userKey: uid || email || 'Community', uid: uid || null, email, displayName };
}