import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { createUserRateLimiter } from '../../middleware/rateLimit.js';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { HttpError } from '../../middleware/errors.js';
import { deleteObject, publicUrlFor, putObject } from '../../storage.js';
import { validateProduct } from '../../models/marketplace.js';
import {
  assertImageFile,
  deleteProductImages,
  MAX_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  uploadProductImages
} from './images.js';
import {
  parseImageKeyList,
  parseProductFields
} from './validation.js';
import {
  browseProducts,
  deleteProductRecord,
  findComparableProducts,
  getProductById,
  insertProduct,
  normalizeProductName,
  listActiveProductsForSeller,
  listProductsForSeller,
  productHasOrders,
  updateProduct
} from './store.js';
import { getPublicSellerProfile } from '../../userStore.js';
import { listCategories } from './categories.js';
import {
  encodeBrowseCursor,
  parseBrowseQuery,
  toBrowseProduct
} from './browse.js';

const FIELDS_ALLOWED = new Set([
  'title', 'description', 'category', 'unit', 'pricePerUnit', 'minOrder',
  'quantityAvailable', 'grade', 'harvestDate', 'availableUntil',
  'county', 'town', 'latitude', 'longitude', 'removeImageKeys', 'imageOrder'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_PRODUCT_IMAGES,
    fields: 20,
    fieldSize: 10 * 1024,
    parts: 26
  }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseImages(req, res, next) {
  upload.array('images', MAX_PRODUCT_IMAGES)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      const tooMany = error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE';
      return next(new HttpError(
        tooLarge ? 413 : 400,
        tooLarge
          ? 'Each image must be 5 MB or smaller.'
          : tooMany ? `A product can have at most ${MAX_PRODUCT_IMAGES} images in the images field.` : 'Multipart upload limits were exceeded.',
        tooLarge ? 'IMAGE_TOO_LARGE' : 'INVALID_MULTIPART'
      ));
    }
    return next(new HttpError(400, 'The multipart upload could not be read.', 'INVALID_MULTIPART'));
  });
}

function assertAllowedFields(body) {
  const unexpected = Object.keys(body).find((key) => !FIELDS_ALLOWED.has(key));
  if (unexpected) throw new HttpError(400, `Field "${unexpected}" cannot be changed here.`, 'INVALID_PRODUCT');
}

function cleanupFailedUpload(uploadedKeys, storage) {
  return Promise.allSettled(uploadedKeys.map((key) => storage.deleteObject(key))).then((results) => {
    if (results.some((result) => result.status === 'rejected')) {
      console.error('Product image rollback could not remove every newly uploaded image.');
    }
  });
}

async function defaultIsAdmin(req) {
  const requireAdmin = requireRole('admin');
  return new Promise((resolve, reject) => {
    requireAdmin(req, {}, (error) => error
      ? error.status === 403 ? resolve(false) : reject(error)
      : resolve(true));
  });
}

async function assertOwnerOrAdmin(product, req, isAdmin) {
  if (product.sellerUid === req.user.uid) return;
  if (await isAdmin(req)) return;
  throw new HttpError(403, 'Only the listing owner or an admin can change this product.', 'FORBIDDEN');
}

function requireMultipart(req, _res, next) {
  if (!req.is('multipart/form-data')) {
    return next(new HttpError(415, 'Product creation requires multipart/form-data.', 'MULTIPART_REQUIRED'));
  }
  return next();
}

function roundStoredLocation(existing, patch) {
  if (!patch.location) return existing;
  const location = { ...existing, ...patch.location };
  if (!patch.location.geo && existing.geo) location.geo = existing.geo;
  return location;
}

function productResponse(product) {
  const { normalizedTitle, ...response } = product;
  return response;
}

export function createProductRouter({
  store = {
    insertProduct,
    getProductById,
    listProductsForSeller,
    updateProduct,
    productHasOrders,
    deleteProductRecord,
    browseProducts,
    listActiveProductsForSeller,
    findComparableProducts
  },
  storage = { putObject, deleteObject, publicUrlFor },
  authMiddleware = requireAuth,
  optionalAuthMiddleware = optionalAuth,
  requireSellerMiddleware = requireRole('seller'),
  isAdmin = defaultIsAdmin,
  getSellerProfile = getPublicSellerProfile,
  browse = store.browseProducts || browseProducts,
  listActiveForSeller = store.listActiveProductsForSeller || listActiveProductsForSeller,
  findComparables = store.findComparableProducts || findComparableProducts,
  categories = listCategories,
  moderateListings = config.moderateListings,
  rateLimiter = createUserRateLimiter()
} = {}) {
  const router = Router();
  const assertKnownCategory = async (category) => {
    if (!category) return;
    const available = await categories();
    if (!available.some((item) => item.id === category)) {
      throw new HttpError(400, 'category is not supported.', 'INVALID_PRODUCT');
    }
  };

  router.get('/categories', asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ categories: await categories() });
  }));

  router.get('/products', optionalAuthMiddleware, asyncRoute(async (req, res) => {
    const options = parseBrowseQuery(req.query);
    const result = await browse(options);
    const products = result.items.map(toBrowseProduct);
    const nextCursor = result.hasMore && result.items.length
      ? encodeBrowseCursor(result.items[result.items.length - 1], options.sort, options.fingerprint)
      : null;
    res.set('Cache-Control', req.user
      ? 'private, no-store'
      : 'public, max-age=15, stale-while-revalidate=30');
    res.json({ products, nextCursor, hasMore: result.hasMore });
  }));

  router.get('/sellers/:uid', optionalAuthMiddleware, asyncRoute(async (req, res) => {
    const seller = await getSellerProfile(req.params.uid);
    if (!seller) throw new HttpError(404, 'Seller not found.', 'SELLER_NOT_FOUND');
    const listings = await listActiveForSeller(req.params.uid);
    res.set('Cache-Control', req.user
      ? 'private, no-store'
      : 'public, max-age=15, stale-while-revalidate=30');
    res.json({ seller, products: listings.map(toBrowseProduct) });
  }));

  router.post(
    '/products',
    authMiddleware,
    rateLimiter,
    requireSellerMiddleware,
    requireMultipart,
    parseImages,
    asyncRoute(async (req, res) => {
      assertAllowedFields(req.body);
      for (const file of req.files || []) assertImageFile(file);
      const fields = parseProductFields(req.body);
      await assertKnownCategory(fields.category);
      const id = randomUUID();
      const { images, uploadedKeys } = await uploadProductImages({
        productId: id,
        files: req.files || [],
        storage
      });
      const now = new Date();
      const product = {
        id,
        sellerUid: req.user.uid,
        status: moderateListings ? 'pending' : 'active',
        ...fields,
        normalizedTitle: normalizeProductName(fields.title),
        quantityReserved: 0,
        images,
        ratingAvg: 0,
        ratingCount: 0,
        createdAt: now,
        updatedAt: now
      };
      const validationError = validateProduct(product);
      if (validationError) {
        await cleanupFailedUpload(uploadedKeys, storage);
        throw new HttpError(400, validationError, 'INVALID_PRODUCT');
      }
      try {
        await store.insertProduct(product);
      } catch (error) {
        await cleanupFailedUpload(uploadedKeys, storage);
        throw error;
      }
      res.set('Cache-Control', 'private, no-store').status(201).json({ product: productResponse(product) });
    })
  );

  router.get('/me/products', authMiddleware, requireSellerMiddleware, asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ products: (await store.listProductsForSeller(req.user.uid)).map(productResponse) });
  }));

  router.get('/products/:id', optionalAuthMiddleware, asyncRoute(async (req, res) => {
    const product = await store.getProductById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    if (product.status !== 'active') {
      if (!req.user) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
      await assertOwnerOrAdmin(product, req, isAdmin);
    }
    res.set('Cache-Control', product.status === 'active' && !req.user ? 'public, max-age=30' : 'private, no-store');
    res.json({ product: productResponse(product) });
  }));

  router.get('/products/:id/price-comparison', optionalAuthMiddleware, asyncRoute(async (req, res) => {
    const product = await store.getProductById(req.params.id);
    if (!product || product.status !== 'active') throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    const unknownQuery = Object.keys(req.query).some((key) => key !== 'county');
    if (unknownQuery) throw new HttpError(400, 'Unsupported comparison filter.', 'INVALID_FILTER');
    const county = String(req.query.county || '').trim();
    if (county.length > 100) throw new HttpError(400, 'county must be at most 100 characters.', 'INVALID_QUERY');
    const matches = await findComparables(product, { county, limit: 20 });
    const comparisons = await Promise.all(matches.map(async (match) => ({
      product: toBrowseProduct(match),
      seller: await getSellerProfile(match.sellerUid)
    })));
    res.set('Cache-Control', req.user ? 'private, no-store' : 'public, max-age=30')
      .json({ productId: product.id, comparisons });
  }));

  router.patch('/products/:id', authMiddleware, rateLimiter, parseImages, asyncRoute(async (req, res) => {
    const existing = await store.getProductById(req.params.id);
    if (!existing) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    await assertOwnerOrAdmin(existing, req, isAdmin);
    assertAllowedFields(req.body);
    for (const file of req.files || []) assertImageFile(file);

    const patch = parseProductFields(req.body, { partial: true });
    await assertKnownCategory(patch.category);
    const originalImages = existing.images || [];
    const removeKeys = parseImageKeyList(req.body.removeImageKeys, 'removeImageKeys');
    const imageOrder = parseImageKeyList(req.body.imageOrder, 'imageOrder');
    const knownKeys = new Set(originalImages.map((image) => image.key));
    if (removeKeys.some((key) => !knownKeys.has(key)) || imageOrder.some((key) => !knownKeys.has(key))) {
      throw new HttpError(400, 'Image changes may only reference images already on this product.', 'INVALID_IMAGE');
    }
    if (removeKeys.some((key) => imageOrder.includes(key))) {
      throw new HttpError(400, 'An image cannot be both removed and included in imageOrder.', 'INVALID_IMAGE');
    }
    const retained = imageOrder.length
      ? imageOrder.map((key) => originalImages.find((image) => image.key === key))
      : originalImages.filter((image) => !removeKeys.includes(image.key));
    const removedImages = originalImages.filter((image) => !retained.some((item) => item.key === image.key));
    const { images: addedImages, uploadedKeys } = await uploadProductImages({
      productId: existing.id,
      files: req.files || [],
      storage
    });
    if (retained.length + addedImages.length > MAX_PRODUCT_IMAGES) {
      await cleanupFailedUpload(uploadedKeys, storage);
      throw new HttpError(400, `A product can have at most ${MAX_PRODUCT_IMAGES} images.`, 'TOO_MANY_IMAGES');
    }

    const update = {
      ...patch,
      ...(patch.title ? { normalizedTitle: normalizeProductName(patch.title) } : {}),
      ...(patch.location ? { location: roundStoredLocation(existing.location, patch) } : {}),
      images: [...retained, ...addedImages],
      updatedAt: new Date()
    };
    const candidate = { ...existing, ...update };
    const validationError = validateProduct(candidate);
    if (validationError) {
      await cleanupFailedUpload(uploadedKeys, storage);
      throw new HttpError(400, validationError, 'INVALID_PRODUCT');
    }
    let saved;
    try {
      saved = await store.updateProduct(existing.id, update);
    } catch (error) {
      await cleanupFailedUpload(uploadedKeys, storage);
      throw error;
    }
    if (!saved) {
      await cleanupFailedUpload(uploadedKeys, storage);
      throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    }
    if (removedImages.length) await deleteProductImages(removedImages, storage);
    res.json({ product: productResponse(saved) });
  }));

  router.post('/products/:id/pause', authMiddleware, asyncRoute(async (req, res) => {
    const product = await store.getProductById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    await assertOwnerOrAdmin(product, req, isAdmin);
    if (product.status !== 'active' && product.status !== 'pending') {
      throw new HttpError(409, 'Only active or pending products can be paused.', 'INVALID_PRODUCT_STATE');
    }
    const saved = await store.updateProduct(product.id, { status: 'paused', updatedAt: new Date() }, product.status);
    if (!saved) throw new HttpError(409, 'The product status changed; reload and try again.', 'PRODUCT_STATE_CHANGED');
    res.json({ product: productResponse(saved) });
  }));

  router.post('/products/:id/resume', authMiddleware, asyncRoute(async (req, res) => {
    const product = await store.getProductById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    await assertOwnerOrAdmin(product, req, isAdmin);
    if (product.status !== 'paused') {
      throw new HttpError(409, 'Only paused products can be resumed.', 'INVALID_PRODUCT_STATE');
    }
    const status = product.quantityAvailable > product.quantityReserved ? 'active' : 'sold_out';
    const saved = await store.updateProduct(product.id, { status, updatedAt: new Date() }, 'paused');
    if (!saved) throw new HttpError(409, 'The product status changed; reload and try again.', 'PRODUCT_STATE_CHANGED');
    res.json({ product: productResponse(saved) });
  }));

  router.delete('/products/:id', authMiddleware, asyncRoute(async (req, res) => {
    const product = await store.getProductById(req.params.id);
    if (!product) throw new HttpError(404, 'Product not found.', 'PRODUCT_NOT_FOUND');
    await assertOwnerOrAdmin(product, req, isAdmin);

    if (await store.productHasOrders(product.id)) {
      const saved = await store.updateProduct(product.id, { status: 'removed', updatedAt: new Date() }, product.status);
      if (!saved) throw new HttpError(409, 'The product changed; reload and try again.', 'PRODUCT_STATE_CHANGED');
      return res.json({ deleted: false, product: productResponse(saved) });
    }

    const hidden = await store.updateProduct(product.id, { status: 'removed', updatedAt: new Date() }, product.status);
    if (!hidden) throw new HttpError(409, 'The product changed; reload and try again.', 'PRODUCT_STATE_CHANGED');
    await deleteProductImages(product.images || [], storage);
    await store.deleteProductRecord(product.id);
    return res.json({ deleted: true });
  }));

  return router;
}
