import { describe, expect, it } from 'vitest';
import { computeLayout, type LayoutInput } from '../src/main/layout';

const base: LayoutInput = {
  columnCount: 4,
  columnWidth: 380,
  areaWidth: 1280,
  zoom: 1,
  sideHeaderIndices: new Set([0]),
  expandedIndex: null,
  isPresent: [true, true, true, true],
};

describe('computeLayout', () => {
  it('adds the side header to the first column with a fixed width', () => {
    const layout = computeLayout(base);
    expect(layout.slots.map((slot) => slot.width)).toEqual([448, 380, 380, 380]);
    expect(layout.slots.map((slot) => slot.x)).toEqual([0, 448, 828, 1208]);
    expect(layout.naturalWidth).toBe(1588);
    expect(layout.contentWidth).toBe(1588);
  });

  it('adds one side header per account', () => {
    const layout = computeLayout({ ...base, sideHeaderIndices: new Set([0, 2]) });
    expect(layout.slots.map((slot) => slot.width)).toEqual([448, 380, 448, 380]);
  });

  it('splits the window between the columns without columnWidth', () => {
    const layout = computeLayout({ ...base, columnWidth: undefined, sideHeaderIndices: new Set([0, 2]) });
    // (1280 - 2 × 68) / 4 = 286
    expect(layout.slots.map((slot) => slot.width)).toEqual([354, 286, 354, 286]);
    expect(layout.naturalWidth).toBe(1280);
  });

  it('uses the whole width for a single column', () => {
    const layout = computeLayout({ ...base, columnCount: 1, columnWidth: undefined, isPresent: [true] });
    expect(layout.slots[0]?.width).toBe(1280);
  });

  it('applies the zoom to the column width', () => {
    const layout = computeLayout({ ...base, zoom: 1.2 });
    expect(layout.slots.map((slot) => slot.width)).toEqual([524, 456, 456, 456]);
  });

  it('hides columns without a page', () => {
    const layout = computeLayout({ ...base, isPresent: [true, true, true, false] });
    expect(layout.slots[3]).toEqual({ x: 1208, width: 0, visible: false });
    expect(layout.contentWidth).toBe(1280);
  });

  it('shows an expanded photo full width and hides the rest', () => {
    const layout = computeLayout({ ...base, expandedIndex: 2 });
    expect(layout.slots.map((slot) => slot.visible)).toEqual([false, false, true, false]);
    expect(layout.slots[2]).toEqual({ x: 0, width: 1280, visible: true });
  });
});
