import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoney, parseMoney } from '../src/lib/money.js';

test('parseMoney accepts integer KES amounts and grouped whole-shilling strings', () => {
  assert.equal(parseMoney(0), 0);
  assert.equal(parseMoney(1250), 1250);
  assert.equal(parseMoney('1250'), 1250);
  assert.equal(parseMoney('1,250'), 1250);
  assert.equal(parseMoney('KES 1,250'), 1250);
});

test('parseMoney rejects decimals, malformed groups, negatives, and unsafe amounts', () => {
  for (const value of ['1.00', '1,25', 'KES 1,250.00', '-1', '']) {
    assert.throws(() => parseMoney(value), TypeError, String(value));
  }
  assert.throws(() => parseMoney(1.5), RangeError);
  assert.throws(() => parseMoney(-1), RangeError);
  assert.throws(() => parseMoney(Number.MAX_SAFE_INTEGER + 1), RangeError);
  assert.throws(() => parseMoney('9007199254740992'), RangeError);
});

test('formatMoney formats whole shillings and rejects floating-point values', () => {
  assert.equal(formatMoney(0), 'KES 0');
  assert.equal(formatMoney(1250), 'KES 1,250');
  assert.throws(() => formatMoney(12.5), RangeError);
});
