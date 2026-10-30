export function priceComparisonPath(productId, county = '') {
  const path = `/products/${encodeURIComponent(productId)}/price-comparison`;
  return county ? `${path}?county=${encodeURIComponent(county)}` : path;
}

export function newConversationRequest(productId, message) {
  return { productId: String(productId || ''), message: String(message || '').trim() };
}

export function unreadBadgeText(count) {
  const value = Number.isSafeInteger(count) && count > 0 ? count : 0;
  return value > 99 ? '99+' : String(value);
}

export function adminDashboardMetrics(summary) {
  return {
    users: Number.isSafeInteger(summary?.users?.total) ? summary.users.total : 0,
    gmvKes: Number.isSafeInteger(summary?.gmv?.amountKes) ? summary.gmv.amountKes : 0,
    paidOrders: Number.isSafeInteger(summary?.gmv?.orderCount) ? summary.gmv.orderCount : 0,
    payoutRecords: Array.isArray(summary?.payouts)
      ? summary.payouts.reduce((sum, item) => sum + (Number.isSafeInteger(item.count) ? item.count : 0), 0)
      : 0
  };
}
