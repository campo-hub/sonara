import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney, parseMoney } from '../src/marketplace/lib/money.js';

test('formats KES from integer amounts and parses whole-shilling input', () => {
  assert.equal(formatMoney(1250), 'KES 1,250');
  assert.equal(parseMoney('KES 1,250'), 1250);
  assert.equal(parseMoney('1250'), 1250);
});

test('rejects fractional and unsafe currency amounts', () => {
  assert.throws(() => parseMoney('12.50'), /whole number/);
  assert.throws(() => formatMoney(12.5), /integer/);
  assert.throws(() => parseMoney(String(Number.MAX_SAFE_INTEGER + 1)), /range/);
});
