export function normalizeCart(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.productId === 'string'
    && item.productId.trim() && Number.isFinite(item.qty) && item.qty > 0)
    .map(({ productId, qty }) => ({ productId: productId.trim(), qty }));
}

export function cartReducer(cart, action) {
  if (action.type === 'add') {
    const existing = cart.find((item) => item.productId === action.productId);
    if (existing) return cart.map((item) => item.productId === action.productId
      ? { ...item, qty: item.qty + action.qty }
      : item);
    return [...cart, { productId: action.productId, qty: action.qty }];
  }
  if (action.type === 'setQuantity') {
    return action.qty > 0
      ? cart.map((item) => item.productId === action.productId ? { ...item, qty: action.qty } : item)
      : cart.filter((item) => item.productId !== action.productId);
  }
  if (action.type === 'remove') return cart.filter((item) => item.productId !== action.productId);
  if (action.type === 'clear') return [];
  return cart;
}
