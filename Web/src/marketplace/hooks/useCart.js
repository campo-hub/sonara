import { useEffect, useReducer } from 'react';
import { cartReducer, normalizeCart } from '../lib/cart.js';

const STORAGE_KEY = 'agristore.cart.v1';

function readStoredCart(storage) {
  try {
    return normalizeCart(JSON.parse(storage?.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function useCart(storage = globalThis.localStorage) {
  const [items, dispatch] = useReducer(cartReducer, storage, readStoredCart);
  useEffect(() => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      return;
    }
  }, [items, storage]);
  return {
    items,
    add: (productId, qty = 1) => dispatch({ type: 'add', productId, qty }),
    setQuantity: (productId, qty) => dispatch({ type: 'setQuantity', productId, qty }),
    remove: (productId) => dispatch({ type: 'remove', productId }),
    clear: () => dispatch({ type: 'clear' })
  };
}

export { cartReducer, normalizeCart, readStoredCart, STORAGE_KEY };
