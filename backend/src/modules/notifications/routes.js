import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { countUnreadNotifications, listNotifications, markAllNotificationsRead, markNotificationRead } from './store.js';

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createNotificationRouter({
  authMiddleware = requireAuth,
  list = listNotifications,
  countUnread = countUnreadNotifications,
  markRead = markNotificationRead,
  markAllRead = markAllNotificationsRead
} = {}) {
  const router = Router();
  router.get('/notifications', authMiddleware, asyncRoute(async (req, res) => {
    const rawLimit = req.query.limit == null ? 50 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
      throw new HttpError(400, 'limit must be between 1 and 100.', 'INVALID_QUERY');
    }
    const [notifications, unreadCount] = await Promise.all([list(req.user.uid, rawLimit), countUnread(req.user.uid)]);
    res.set('Cache-Control', 'private, no-store').json({ notifications, unreadCount });
  }));
  router.post('/notifications/read-all', authMiddleware, asyncRoute(async (req, res) => {
    const modifiedCount = await markAllRead(req.user.uid);
    res.set('Cache-Control', 'private, no-store').json({ modifiedCount });
  }));
  router.post('/notifications/:id/read', authMiddleware, asyncRoute(async (req, res) => {
    const notification = await markRead(req.user.uid, req.params.id);
    if (!notification) throw new HttpError(404, 'Notification not found.', 'NOTIFICATION_NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').json({ notification });
  }));
  return router;
}
