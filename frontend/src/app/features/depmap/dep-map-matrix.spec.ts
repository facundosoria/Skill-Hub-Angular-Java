import { calculateMatrixLayout } from './dep-map-matrix';

describe('calculateMatrixLayout', () => {
  it('fits 13 groups plus the totals row within wrapper padding', () => {
    const layout = calculateMatrixLayout(719, 594, 14, 13);

    expect(layout.cell).toBeCloseTo(34.33, 2);
    expect(layout.rowLabel).toBe(150);
    expect(layout.header).toBeCloseTo(85.82, 2);
    // 12px top + 12px bottom wrapper padding, one header and 14 body rows.
    expect(24 + layout.header + 14 * layout.cell).toBeLessThanOrEqual(594);
  });

  it('caps cells at the existing size when there is room', () => {
    expect(calculateMatrixLayout(1200, 800, 14, 13).cell).toBe(44);
  });

  it('keeps the readable floor and allows overflow when height is insufficient', () => {
    expect(calculateMatrixLayout(645, 462, 14, 13).cell).toBe(28);
  });
});
