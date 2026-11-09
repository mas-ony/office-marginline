/**
 * Colour palette for text colour, highlight and cell background: eight hue rows of seven
 * shades, from dark to light (designed for this editor).
 */
interface Hue {
  name: string;
  h: number;
  s: number;
}

const HUES: Hue[] = [
  { name: 'red', h: 0, s: 72 },
  { name: 'orange', h: 26, s: 85 },
  { name: 'yellow', h: 48, s: 92 },
  { name: 'green', h: 135, s: 52 },
  { name: 'teal', h: 178, s: 60 },
  { name: 'blue', h: 214, s: 76 },
  { name: 'purple', h: 268, s: 58 },
];

const LIGHTNESS = [24, 36, 48, 60, 72, 84, 93];
const SHADE_NAMES = ['darkest', 'darker', 'dark', '', 'light', 'lighter', 'lightest'];
const GRAYS: [string, string][] = [
  ['000000', 'black'],
  ['3C3C3C', 'charcoal'],
  ['666666', 'dark gray'],
  ['8C8C8C', 'gray'],
  ['B4B4B4', 'silver'],
  ['DCDCDC', 'light gray'],
  ['FFFFFF', 'white'],
];

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

export interface Swatch {
  hex: string;
  name: string;
}

export const PALETTE: Swatch[][] = [
  GRAYS.map(([hex, name]) => ({ hex, name })),
  ...HUES.map((hue) => LIGHTNESS.map((l, i) => ({
    hex: hslToHex(hue.h, hue.s, l),
    name: [SHADE_NAMES[i], hue.name].filter(Boolean).join(' '),
  }))),
];
