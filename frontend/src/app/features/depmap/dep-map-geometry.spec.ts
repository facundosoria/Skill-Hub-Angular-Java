import {
  edgeClass,
  edgeStrokeWidth,
  geom,
  nodeClass,
  pairs,
  relationForTimestamp,
  touchedNodes,
} from './dep-map-geometry';

describe('dep-map geometry', () => {
  const nodes = {
    cur: { x: 500, y: 255 },
    acc: { x: 315, y: 392 },
    usr: { x: 300, y: 112 },
    not: { x: 760, y: 112 },
  };

  it('matches the original literal path and badge position for cur > acc', () => {
    const result = geom(nodes, 'cur', 'acc', false);
    expect(result.d).toBe('M452.8,284.0 Q401.5,315.5 352.3,359.0');
    expect(result.lx).toBeCloseTo(402.04867348328867, 10);
    expect(result.ly).toBeCloseTo(318.48182930437986, 10);
  });

  it('matches the wider reverse curve when both directions exist', () => {
    const result = geom(nodes, 'cur', 'acc', true);
    expect(result.d).toBe('M437.1,284.0 Q393.2,304.2 344.4,359.0');
    expect(result.lx).toBeCloseTo(391.97792780077486, 10);
    expect(result.ly).toBeCloseTo(312.8563903305117, 10);
  });

  it('keeps horizontal paths and grouping compatible with the original', () => {
    expect(geom(nodes, 'usr', 'not', false).d).toBe('M387.0,115.8 Q530.0,122.0 669.0,116.0');
    const grouped = pairs([
      { id: 'e1', from: 'cur', to: 'acc' },
      { id: 'e2', from: 'cur', to: 'acc' },
      { id: 'e3', from: 'acc', to: 'cur' },
    ]);
    expect(grouped.get('cur>acc')?.map((edge) => edge.id)).toEqual(['e1', 'e2']);
    expect(grouped.get('acc>cur')?.map((edge) => edge.id)).toEqual(['e3']);
  });

  it('preserves classes, touched nodes, and literal width calculation', () => {
    const edges = [
      { id: 'e1', from: 'cur', to: 'acc', kind: 'x', state: 'pendiente', text: 'one' },
      { id: 'e2', from: 'cur', to: 'acc', kind: 'x', state: 'pendiente', text: 'two' },
    ];
    expect(touchedNodes(edges, 'cur')).toEqual(new Set(['oacc']));
    expect(edgeClass('cur', 'acc', 'cur', null)).toBe('out');
    expect(edgeClass('acc', 'cur', 'cur', null)).toBe('in');
    expect(edgeClass('cur', 'acc', null, ['cur', 'acc'])).toBe('sel');
    expect(nodeClass('acc', 'cur', null, new Set(['oacc']))).toBe('out');
    expect(edgeStrokeWidth(2)).toBe('2.10');
    expect(edgeStrokeWidth(9)).toBe('3.90');
  });

  it('keeps the original relative time thresholds', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(relationForTimestamp('2025-12-31T23:59:30.000Z', now)).toBe('recién');
    expect(relationForTimestamp('2025-12-31T23:58:30.000Z', now)).toBe('hace 2 min');
    expect(relationForTimestamp('2025-12-30T00:00:00.000Z', now)).toBe('hace 2 d');
  });
});
