import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { requireRole } from '../../middleware/roles.js';
import { createCategory, listCategories, removeCategory, renameCategory } from '../products/categories.js';

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function createCategoryAdminRouter({
  authMiddleware = requireAuth,
  requireAdminMiddleware = requireRole('admin'),
  list = listCategories,
  create = createCategory,
  rename = renameCategory,
  remove = removeCategory
} = {}) {
  const router = Router();
  const protect = [authMiddleware, requireAdminMiddleware];
  router.get('/admin/categories', ...protect, asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ categories: await list() });
  }));
  router.post('/admin/categories', ...protect, asyncRoute(async (req, res) => {
    const category = await create(req.body?.name);
    res.set('Cache-Control', 'private, no-store').status(201).json({ category });
  }));
  router.patch('/admin/categories/:id', ...protect, asyncRoute(async (req, res) => {
    const category = await rename(req.params.id, req.body?.name);
    if (!category) throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').json({ category });
  }));
  router.delete('/admin/categories/:id', ...protect, asyncRoute(async (req, res) => {
    if (!await remove(req.params.id)) throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').json({ deleted: true });
  }));
  return router;
}
