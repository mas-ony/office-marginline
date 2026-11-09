import { describe, expect, it } from 'vitest';
import { distanceText, parseDistance } from '../../src/ui/content';

describe('header and footer distances in the Options menu', () => {
  it('shows a distance in inches, or in centimetres where the ruler is metric', () => {
    expect(distanceText(720, false)).toBe('0.50');
    expect(distanceText(432, false)).toBe('0.30');
    expect(distanceText(720, true)).toBe('1.27');
    expect(distanceText(1440, true)).toBe('2.54');
  });

  it('reads a typed distance with a point or a comma, up to the largest allowed', () => {
    expect(parseDistance('0.3', 5280, false)).toBe(432);
    expect(parseDistance('0,3', 5280, false)).toBe(432);
    expect(parseDistance(' 1.27 ', 5280, true)).toBe(720);
    expect(parseDistance('0', 5280, false)).toBe(0);
    expect(parseDistance('9', 5280, false)).toBe(5280);
  });

  it('refuses text that is not a distance', () => {
    for (const text of ['', '   ', 'abc', '-0.1', 'Infinity', '0.3 in']) expect(parseDistance(text, 5280, false)).toBeNull();
  });
});
