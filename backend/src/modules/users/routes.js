import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { validateJsonBody } from '../../middleware/validate.js';
import { getUserProfile, saveUserProfile, validateUsername } from '../../userStore.js';

const router = Router();

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    res.json({ profile: await getUserProfile(req.user.uid) });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/profile',
  requireAuth,
  validateJsonBody((body) => validateUsername(body.username)),
  async (req, res, next) => {
    try {
      const profile = await saveUserProfile({
        uid: req.user.uid,
        email: req.user.email,
        username: req.body.username
      });
      res.json({ profile });
    } catch (error) {
      if (error?.code === 11000) {
        return next(new HttpError(409, 'That username is already in use.', 'USERNAME_TAKEN'));
      }
      return next(error);
    }
  }
);

export default router;
