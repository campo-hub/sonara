import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAccentPalette, contrast } from '../src/colorUtils.js';

test('all preset accents produce readable foregrounds in light and dark modes', () => {
  const presets = ['#D83A22', '#B7791F', '#4D6B3F', '#2F4B6E', '#2F7470', '#2B2A27'];
  for (const mode of ['light', 'dark']) {
    for (const accent of presets) {
      const palette = buildAccentPalette(accent, mode);
      assert.ok(contrast(palette.onAccent, palette.accent) >= 4.5);
      palette.tones.forEach((tone, index) => assert.ok(contrast(palette.toneForegrounds[index], tone) >= 4.5));
    }
  }
});

test('extreme custom colors remain readable and intensity changes tint strength', () => {
  for (const accent of ['#ffffff', '#000000', '#ffff00', '#0000ff']) {
    const subtle = buildAccentPalette(accent, 'light', 'subtle');
    const immersive = buildAccentPalette(accent, 'light', 'immersive');
    assert.ok(contrast(subtle.onAccent, subtle.accent) >= 4.5);
    assert.notEqual(subtle.tintBg, immersive.tintBg);
  }
});

test('derived neutral lines stay below the hairline contrast bound', () => {
  const accents = ['#D83A22', '#B7791F', '#4D6B3F', '#2F4B6E', '#2F7470', '#2B2A27', '#7A2C91', '#ffffff', '#000000', '#ffff00', '#0000ff'];
  for (const mode of ['light', 'dark']) {
    for (const accent of accents) {
      const palette = buildAccentPalette(accent, mode);
      assert.ok(contrast(palette.tintLine, palette.tintBg) <= 1.5);
      assert.ok(contrast(palette.tintLine, palette.tintPaper) <= 1.5);
    }
  }
});