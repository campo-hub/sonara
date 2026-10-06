import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMixGridFit } from '../src/lib/homeFit.js';

test('mix cards stay in a 4–5 column desktop grid even when only one mix exists', () => {
  const fit = computeMixGridFit({ width: 678, count: 1 });

  assert.equal(fit.columns, 5);
  assert.ok(fit.cardSize <= 190);
});

test('mix grid uses four columns when five minimum-size cards do not fit', () => {
  const fit = computeMixGridFit({ width: 600, count: 12 });

  assert.equal(fit.columns, 4);
  assert.ok(fit.cardSize <= 190);
});

test('mix cards never exceed the maximum size on wide screens', () => {
  const fit = computeMixGridFit({ width: 1200, count: 12 });

  assert.equal(fit.columns, 5);
  assert.equal(fit.cardSize, 190);
});

test('mix grid reduces columns when the container is narrow', () => {
  const fit = computeMixGridFit({ width: 400, count: 12 });

  assert.equal(fit.columns, 3);
});