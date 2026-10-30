import assert from 'node:assert/strict';
import test from 'node:test';
import { adminDashboardMetrics, newConversationRequest, priceComparisonPath, unreadBadgeText } from '../src/marketplace/lib/featureUtils.js';

test('price comparison requests encode optional county filters', () => {
  assert.equal(priceComparisonPath('product/1'), '/products/product%2F1/price-comparison');
  assert.equal(priceComparisonPath('p1', 'Uasin Gishu'), '/products/p1/price-comparison?county=Uasin%20Gishu');
});

test('new conversation requests contain only product context and trimmed text', () => {
  assert.deepEqual(newConversationRequest('product-1', '  Habari farmer  '), {
    productId: 'product-1',
    message: 'Habari farmer'
  });
});

test('notification unread badge handles invalid and large counts', () => {
  assert.equal(unreadBadgeText(0), '0');
  assert.equal(unreadBadgeText(8), '8');
  assert.equal(unreadBadgeText(150), '99+');
  assert.equal(unreadBadgeText(-1), '0');
});

test('admin dashboard metrics use whole KES and aggregate payout record counts', () => {
  assert.deepEqual(adminDashboardMetrics({
    users: { total: 14 },
    gmv: { amountKes: 2500, orderCount: 3 },
    payouts: [{ count: 2 }, { count: 4 }]
  }), { users: 14, gmvKes: 2500, paidOrders: 3, payoutRecords: 6 });
  assert.deepEqual(adminDashboardMetrics(null), { users: 0, gmvKes: 0, paidOrders: 0, payoutRecords: 0 });
});
