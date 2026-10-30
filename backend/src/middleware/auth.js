import { verifyIdToken } from '../firebaseAdmin.js';
import { HttpError } from './errors.js';

export function createRequireAuth(verifyToken = verifyIdToken) {
  return async function requireAuth(req, _res, next) {
    const authorization = req.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return next(new HttpError(401, 'Sign in to continue.', 'UNAUTHENTICATED'));

    try {
      const decoded = await verifyToken(match[1]);
      if (!decoded?.uid) throw new Error('Token has no user identifier.');
      req.user = {
        uid: decoded.uid,
        email: decoded.email || '',
        email_verified: decoded.email_verified === true,
        name: decoded.name || ''
      };
      return next();
    } catch {
      return next(new HttpError(401, 'Your sign-in session is invalid or expired.', 'UNAUTHENTICATED'));
    }
  };
}

export const requireAuth = createRequireAuth();

export function createOptionalAuth(verifyToken = verifyIdToken) {
  return async function optionalAuth(req, _res, next) {
    req.user = null;
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return next();
    try {
      const decoded = await verifyToken(match[1]);
      if (decoded?.uid) {
        req.user = {
          uid: decoded.uid,
          email: decoded.email || '',
          email_verified: decoded.email_verified === true,
          name: decoded.name || ''
        };
      }
      return next();
    } catch {
      return next();
    }
  };
}

export const optionalAuth = createOptionalAuth();
