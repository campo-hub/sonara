import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { HttpError } from '../../middleware/errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGES = 5;
const MAX_INPUT_PIXELS = 40_000_000;

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer) {
  return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isWebp(buffer) {
  return buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
}

export function assertImageFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new HttpError(400, 'An image file is required.', 'INVALID_IMAGE');
  }
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'Each image must be 5 MB or smaller.', 'IMAGE_TOO_LARGE');
  }
  if (!isJpeg(file.buffer) && !isPng(file.buffer) && !isWebp(file.buffer)) {
    throw new HttpError(415, 'Only JPEG, PNG, and WebP image contents are accepted.', 'UNSUPPORTED_IMAGE');
  }
}

export async function processImage(file) {
  assertImageFile(file);
  let image;
  try {
    image = sharp(file.buffer, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    const full = await image.clone().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await image.clone().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 }).toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    throw new HttpError(415, 'The uploaded file is not a supported, readable image.', 'INVALID_IMAGE');
  }
}

export async function uploadProductImages({ productId, files, storage }) {
  if (files.length > MAX_PRODUCT_IMAGES) {
    throw new HttpError(400, `A product can have at most ${MAX_PRODUCT_IMAGES} images.`, 'TOO_MANY_IMAGES');
  }
  const processed = [];
  for (const file of files) processed.push(await processImage(file));

  const uploadedKeys = [];
  const images = [];
  try {
    for (const image of processed) {
      const imageId = randomUUID();
      const key = `products/${productId}/${imageId}.webp`;
      const thumbKey = `products/${productId}/${imageId}-thumb.webp`;
      await storage.putObject(key, image.full, 'image/webp', { cacheControl: 'public, max-age=31536000, immutable' });
      uploadedKeys.push(key);
      await storage.putObject(thumbKey, image.thumb, 'image/webp', { cacheControl: 'public, max-age=31536000, immutable' });
      uploadedKeys.push(thumbKey);
      const url = storage.publicUrlFor(key);
      const thumbUrl = storage.publicUrlFor(thumbKey);
      if (!url || !thumbUrl) throw new Error('Product image public URL is not configured.');
      images.push({
        key,
        url,
        thumbKey,
        thumbUrl,
        width: image.width,
        height: image.height
      });
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled(uploadedKeys.map((key) => storage.deleteObject(key)));
    if (cleanupResults.some((result) => result.status === 'rejected')) {
      console.error('Product image upload rollback could not remove every uploaded image.');
    }
    throw error;
  }
  return { images, uploadedKeys };
}

export async function deleteProductImages(images, storage) {
  const keys = [...new Set(images.flatMap((image) => [image.key, image.thumbKey]).filter(Boolean))];
  const results = await Promise.allSettled(keys.map((key) => storage.deleteObject(key)));
  const failedKeys = results.flatMap((result, index) => result.status === 'rejected' ? [keys[index]] : []);
  if (failedKeys.length) {
    throw new Error(`Failed to remove ${failedKeys.length} product image object(s).`);
  }
}
