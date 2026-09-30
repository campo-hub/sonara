const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const parseHex = (hex) => {
  const value = String(hex || '').replace('#', '').trim();
  const normalized = value.length === 3 ? value.split('').map((part) => `${part}${part}`).join('') : value.padEnd(6, '0').slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return [number >> 16 & 255, number >> 8 & 255, number & 255].map((channel) => channel / 255);
};

const toHex = (channels) => `#${channels.map((channel) => Math.round(clamp(channel) * 255).toString(16).padStart(2, '0')).join('')}`;

const rgbToHsl = ([red, green, blue]) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
};

const hslToRgb = ([hue, saturation, lightness]) => {
  if (!saturation) return [lightness, lightness, lightness];
  const hueToRgb = (p, q, t) => {
    let next = t;
    if (next < 0) next += 1;
    if (next > 1) next -= 1;
    if (next < 1 / 6) return p + (q - p) * 6 * next;
    if (next < 1 / 2) return q;
    if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
};

const relativeLuminance = (hex) => parseHex(hex).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

export const contrast = (foreground, background) => {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
};

const readableText = (background) => contrast('#ffffff', background) >= contrast('#111111', background) ? '#ffffff' : '#111111';
const readablePair = (background, hue, saturation, lightness) => {
  const foreground = readableText(background);
  if (contrast(foreground, background) >= 4.5) return { color: background, foreground };
  const adjustedLightness = contrast('#111111', background) > contrast('#ffffff', background) ? 0.78 : 0.22;
  const adjusted = toHex(hslToRgb([hue, saturation, adjustedLightness]));
  return { color: adjusted, foreground: readableText(adjusted) };
};
const mix = (base, accent, amount) => {
  const first = parseHex(base);
  const second = parseHex(accent);
  return toHex(first.map((channel, index) => channel + (second[index] - channel) * amount));
};

export const buildAccentPalette = (hex, mode = 'light', intensity = 'balanced') => {
  const accent = toHex(parseHex(hex));
  const [hue, saturation, lightness] = rgbToHsl(parseHex(accent));
  const tintAmount = intensity === 'immersive' ? 0.14 : intensity === 'subtle' ? 0.04 : 0.08;
  const base = mode === 'dark' ? '#15130f' : '#edebe6';
  const paper = mode === 'dark' ? '#1e1b16' : '#f8f6f2';
  const raised = mode === 'dark' ? '#2a2720' : '#e2dfd8';
  const line = mode === 'dark' ? '#3a362d' : '#d2cec4';
  const harmony = [0, 0.08, -0.08, 0.5, 0.33, 0.66].map((offset, index) => {
    const toneSaturation = clamp(saturation * (index === 3 ? 0.8 : 1), 0.18, 0.8);
    const toneLightness = clamp(mode === 'dark' ? lightness * 0.9 + 0.08 : lightness * 0.85 + 0.08, 0.22, 0.7);
    const color = toHex(hslToRgb([(hue + offset + 1) % 1, toneSaturation, toneLightness]));
    return readablePair(color, (hue + offset + 1) % 1, toneSaturation, toneLightness);
  });
  return {
    accent,
    accentStrong: toHex(hslToRgb([hue, saturation, clamp(lightness + (mode === 'dark' ? 0.08 : -0.08), 0.18, 0.72)])),
    accentSoft: mix(paper, accent, tintAmount),
    onAccent: readableText(accent),
    tintBg: mix(base, accent, tintAmount),
    tintPaper: mix(paper, accent, tintAmount),
    tintRaised: mix(raised, accent, tintAmount),
    tintLine: mix(line, accent, tintAmount),
    tones: harmony.map((item) => item.color),
    toneForegrounds: harmony.map((item) => item.foreground),
    contrast
  };
};