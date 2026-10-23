import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { validateJsonBody } from '../../middleware/validate.js';
import { getUserProfile, saveSellerProfile, saveUserProfile, validateUsername } from '../../userStore.js';

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

router.put('/seller-profile', requireAuth, async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['displayName', 'bio', 'county', 'town'].includes(key))) {
      throw new HttpError(400, 'Seller profile fields are invalid.', 'INVALID_SELLER_PROFILE');
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
    const county = typeof body.county === 'string' ? body.county.trim() : '';
    const town = typeof body.town === 'string' ? body.town.trim() : '';
    if (!displayName || displayName.length > 100 || bio.length > 1000
      || !county || county.length > 100 || !town || town.length > 100) {
      throw new HttpError(400, 'Provide a business name, county, town, and bio of at most 1000 characters.', 'INVALID_SELLER_PROFILE');
    }
    const profile = await saveSellerProfile({
      uid: req.user.uid,
      email: req.user.email,
      displayName,
      bio,
      county,
      town
    });
    res.set('Cache-Control', 'private, no-store').json({ profile });
  } catch (error) {
    next(error);
  }
});

export default router;
