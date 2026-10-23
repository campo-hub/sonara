import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from './config.js';

let auth = null;

export function isFirebaseConfigured() {
  return Boolean(config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey);
}

function getAuthClient() {
  if (auth) return auth;
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.');
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey
      })
    });
  }
  auth = getAuth();
  return auth;
}

export async function verifyIdToken(token) {
  return getAuthClient().verifyIdToken(token);
}

export async function getFirebaseUserRecord(uid) {
  return getAuthClient().getUser(uid);
}
