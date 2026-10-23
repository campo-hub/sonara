import { createContext, useContext } from 'react';
import { useCart } from './useCart.js';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  return <CartContext.Provider value={useCart()}>{children}</CartContext.Provider>;
}

export function useCartContext() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCartContext must be used inside CartProvider.');
  return value;
}
