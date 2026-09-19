const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const hasConfig = Object.values(firebaseConfig).every(Boolean);
const firebase = typeof window !== 'undefined' ? window.firebase : null;

if (firebase && hasConfig && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase && hasConfig ? firebase.auth() : null;

export const isFirebaseConfigured = Boolean(auth);

export function subscribeToAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return auth.onAuthStateChanged(callback);
}

export async function signInWithGoogle() {
  if (!auth) throw new Error('Firebase authentication is not configured for this build.');
  const provider = new firebase.auth.GoogleAuthProvider();
  return auth.signInWithPopup(provider);
}

export async function signInWithEmail(email, password) {
  if (!auth) throw new Error('Firebase authentication is not configured for this build.');
  return auth.signInWithEmailAndPassword(email, password);
}

export async function createAccountWithEmail(email, password) {
  if (!auth) throw new Error('Firebase authentication is not configured for this build.');
  return auth.createUserWithEmailAndPassword(email, password);
}

export async function signOutUser() {
  if (auth) await auth.signOut();
}

export async function getCurrentIdToken() {
  return auth?.currentUser ? auth.currentUser.getIdToken() : null;
}
