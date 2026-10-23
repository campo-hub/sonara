import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, 'Route not found.', 'NOT_FOUND'));
}

export function createErrorHandler({ isProduction = config.isProduction } = {}) {
  return function errorHandler(error, _req, res, next) {
    if (res.headersSent) return next(error);

    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : error?.type === 'entity.too.large' ? 413 : 500;
    const knownClientError = status >= 400 && status < 500;
    const message = status === 500
      ? 'An unexpected server error occurred.'
      : error?.type === 'entity.too.large'
        ? 'JSON body exceeds the 100 kB limit.'
        : error?.type === 'entity.parse.failed'
          ? 'Request body must contain valid JSON.'
          : knownClientError ? error.message || 'The request could not be completed.' : 'An unexpected server error occurred.';
    const code = status === 500
      ? 'INTERNAL_ERROR'
      : error?.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE'
        : error?.type === 'entity.parse.failed' ? 'INVALID_JSON'
          : error.code || 'REQUEST_FAILED';

    const response = { error: { code, message } };
    if (!isProduction && status === 500) {
      response.error.stack = error.stack;
    }
    res.status(status).json(response);
  };
}

export const errorHandler = createErrorHandler();
