import assert from 'node:assert/strict';
import test from 'node:test';
import { cartReducer, normalizeCart, readStoredCart, STORAGE_KEY } from '../src/marketplace/hooks/useCart.js';

test('cart stores only product identifiers and quantities and merges duplicate additions', () => {
  const initial = normalizeCart([{ productId: 'p1', qty: 2, unitPrice: 1 }, { productId: '', qty: 2 }, null]);
  assert.deepEqual(initial, [{ productId: 'p1', qty: 2 }]);
  assert.deepEqual(cartReducer(initial, { type: 'add', productId: 'p1', qty: 1 }), [{ productId: 'p1', qty: 3 }]);
});

test('cart quantity and removal actions persist cleanly from storage', () => {
  const cart = [{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 1 }];
  assert.deepEqual(cartReducer(cart, { type: 'setQuantity', productId: 'p1', qty: 4 }), [
    { productId: 'p1', qty: 4 }, { productId: 'p2', qty: 1 }
  ]);
  assert.deepEqual(cartReducer(cart, { type: 'remove', productId: 'p2' }), [{ productId: 'p1', qty: 2 }]);
  const storage = { getItem: (key) => key === STORAGE_KEY ? JSON.stringify(cart) : null };
  assert.deepEqual(readStoredCart(storage), cart);
});
