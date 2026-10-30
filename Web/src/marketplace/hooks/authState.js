import { auth } from '../firebase.js';

export function getCurrentUser() {
  return auth?.currentUser || null;
}
