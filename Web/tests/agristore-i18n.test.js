import assert from 'node:assert/strict';
import test from 'node:test';
import { getLanguage, setLanguage, translate } from '../src/marketplace/lib/i18n.js';

test('English and Swahili labels resolve with English fallback', () => {
  assert.equal(translate('en', 'browse'), 'Browse produce');
  assert.equal(translate('sw', 'browse'), 'Tafuta mazao');
  assert.equal(translate('sw', 'unknown'), 'unknown');
});

test('language preference persists and rejects unsupported locales', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(setLanguage('sw', storage), 'sw');
  assert.equal(getLanguage(storage), 'sw');
  assert.throws(() => setLanguage('fr', storage), /Unsupported/);
});
