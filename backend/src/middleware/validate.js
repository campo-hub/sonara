import { HttpError } from './errors.js';

export function validateJsonBody(validate) {
  return (req, _res, next) => {
    const message = validate(req.body || {});
    if (message) return next(new HttpError(400, message, 'INVALID_REQUEST'));
    return next();
  };
}
