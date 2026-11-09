/** Unit conversions used by WordprocessingML. All layout math in the editor uses CSS px at 96 dpi. */

export const TWIPS_PER_INCH = 1440;
export const EMU_PER_INCH = 914400;
export const PX_PER_INCH = 96;
export const PT_PER_INCH = 72;
export const EMU_PER_PX = EMU_PER_INCH / PX_PER_INCH; // 9525
export const TWIPS_PER_PX = TWIPS_PER_INCH / PX_PER_INCH; // 15

export const twipsToPx = (t: number) => t / TWIPS_PER_PX;
export const pxToTwips = (px: number) => Math.round(px * TWIPS_PER_PX);
export const twipsToPt = (t: number) => t / 20;
export const ptToTwips = (pt: number) => Math.round(pt * 20);
export const emuToPx = (e: number) => e / EMU_PER_PX;
export const pxToEmu = (px: number) => Math.round(px * EMU_PER_PX);
export const ptToPx = (pt: number) => (pt * PX_PER_INCH) / PT_PER_INCH;
export const pxToPt = (px: number) => (px * PT_PER_INCH) / PX_PER_INCH;

export type LayoutUnit = 'cm' | 'mm' | 'inch' | 'pt';

const TWIPS_PER_UNIT: Record<LayoutUnit, number> = {
  cm: TWIPS_PER_INCH / 2.54,
  mm: TWIPS_PER_INCH / 25.4,
  inch: TWIPS_PER_INCH,
  pt: 20,
};

export function toTwips(value: number, unit: LayoutUnit): number {
  return Math.round(value * TWIPS_PER_UNIT[unit]);
}

export function fromTwips(twips: number, unit: LayoutUnit): number {
  return twips / TWIPS_PER_UNIT[unit];
}

export function convertUnits(value: number, from: LayoutUnit, to: LayoutUnit): number {
  return (value * TWIPS_PER_UNIT[from]) / TWIPS_PER_UNIT[to];
}

const UNIT_RE = /^\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*(mm|cm|in|pt|pc|pi|px|emu|%)?\s*$/;

/**
 * Parse an OOXML measure into the given base unit. Values may be plain numbers (already in the
 * base unit) or "universal measures" such as `2.54cm` / `72pt` (allowed by ISO 29500).
 */
export function parseMeasure(value: string | undefined, base: 'twips' | 'emu' | 'halfPt' | 'eighthPt'): number | undefined {
  if (value === undefined || value === '') return undefined;
  const m = UNIT_RE.exec(value);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  const unit = m[2];
  if (!unit) return num;
  let inches: number;
  switch (unit) {
    case 'mm': inches = num / 25.4; break;
    case 'cm': inches = num / 2.54; break;
    case 'in': inches = num; break;
    case 'pt': inches = num / 72; break;
    case 'pc':
    case 'pi': inches = (num * 12) / 72; break;
    case 'px': inches = num / 96; break;
    case 'emu': inches = num / EMU_PER_INCH; break;
    default: return num;
  }
  switch (base) {
    case 'twips': return Math.round(inches * TWIPS_PER_INCH);
    case 'emu': return Math.round(inches * EMU_PER_INCH);
    case 'halfPt': return Math.round(inches * 144);
    case 'eighthPt': return Math.round(inches * 576);
  }
}

/** Parse ST_OnOff (true/false/on/off/1/0). A missing value means "on". */
export function parseOnOff(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !(value === 'false' || value === '0' || value === 'off');
}

/** Parse a percentage given in fiftieths of a percent ("5000") or as "100%". Returns 0..100+. */
export function parsePct(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (value.endsWith('%')) return parseFloat(value);
  const n = parseFloat(value);
  return Number.isFinite(n) ? n / 50 : undefined;
}

export function parseIntSafe(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
