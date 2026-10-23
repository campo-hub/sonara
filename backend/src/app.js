import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, HttpError, notFoundHandler } from './middleware/errors.js';
import { createGlobalRateLimiter, createStrictRateLimiter } from './middleware/rateLimit.js';
import healthRoutes from './modules/health/routes.js';
import userRoutes from './modules/users/routes.js';
import { requireAuth } from './middleware/auth.js';
import { createProductRouter } from './modules/products/routes.js';

export function createApp({ productRouter = createProductRouter() } = {}) {
  const app = express();
  const disableSharedCaching = (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  };
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.has(origin)) return callback(null, true);
      return callback(new HttpError(403, 'Origin is not allowed.', 'CORS_ORIGIN_DENIED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createGlobalRateLimiter());
  app.use(['/api/auth', '/api/uploads', '/api/orders', '/api/payments'], createStrictRateLimiter());

  app.get('/', (_req, res) => res.type('text/plain').send('AgriStore API is running. See /api/health.'));
  app.use('/api/auth', disableSharedCaching);
  app.use('/api/me', disableSharedCaching);
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });
  app.use('/api', healthRoutes);
  app.use('/api/me', userRoutes);
  app.use('/api', productRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
