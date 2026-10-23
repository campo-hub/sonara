import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export function createGlobalRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
    ...options
  });
}

export function createStrictRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
    ...options
  });
}

export function createUserRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip),
    message: { error: { code: 'RATE_LIMITED', message: 'Too many upload requests. Try again later.' } },
    ...options
  });
}
