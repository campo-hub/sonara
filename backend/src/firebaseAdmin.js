import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let auth = null;

export function isFirebaseConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

function getAuthClient() {
  if (auth) return auth;
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Render/most env-var UIs store newlines as literal "\n" - restore them.
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      })
    });
  }
  auth = getAuth();
  return auth;
}

export async function verifyIdToken(token) {
  return getAuthClient().verifyIdToken(token);
}
