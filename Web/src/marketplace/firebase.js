import { initializeApp, getApps } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';

const env = import.meta.env || {};
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

export const isFirebaseConfigured = Object.values(config).every(Boolean);
export const auth = isFirebaseConfigured
  ? getAuth(getApps()[0] || initializeApp(config))
  : null;
export const phoneAuthEnabled = env.VITE_ENABLE_PHONE_AUTH === 'true';

function requireAuth() {
  if (!auth) throw new Error('Authentication is not configured for this deployment.');
  return auth;
}

export function subscribeToAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export async function createAccountWithEmail(email, password, displayName) {
  const result = await createUserWithEmailAndPassword(requireAuth(), email, password);
  if (displayName.trim()) await updateProfile(result.user, { displayName: displayName.trim() });
  return result;
}

export function signInWithGoogle() {
  return signInWithPopup(requireAuth(), new GoogleAuthProvider());
}

export async function sendPhoneCode(phone, containerId) {
  if (!phoneAuthEnabled) throw new Error('Phone sign-in is disabled.');
  const verifier = new RecaptchaVerifier(requireAuth(), containerId, { size: 'invisible' });
  return signInWithPhoneNumber(requireAuth(), phone, verifier);
}

export function signOutUser() {
  return auth ? signOut(auth) : Promise.resolve();
}
