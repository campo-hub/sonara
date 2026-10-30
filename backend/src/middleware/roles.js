import { config } from '../config.js';
import { getUserRoles } from '../userStore.js';
import { HttpError } from './errors.js';

const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map();

async function cachedRoles(uid, lookup = getUserRoles) {
  const cached = roleCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.roles;

  const roles = await lookup(uid);
  roleCache.set(uid, { roles, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return roles;
}

export function clearRoleCache() {
  roleCache.clear();
}

export function createRequireRole(role, { lookup = getUserRoles, adminEmails = config.adminEmails } = {}) {
  if (!['seller', 'admin'].includes(role)) {
    throw new TypeError(`Unsupported role: ${role}`);
  }

  return async function requireRole(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Sign in to continue.', 'UNAUTHENTICATED'));

    try {
      const email = String(req.user.email || '').trim().toLowerCase();
      const verifiedAdmin = role === 'admin'
        && req.user.email_verified === true
        && adminEmails.has(email);
      if (verifiedAdmin) return next();
      const roles = await cachedRoles(req.user.uid, lookup);
      if (!roles.includes(role)) {
        return next(new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireRole = (role) => createRequireRole(role);
