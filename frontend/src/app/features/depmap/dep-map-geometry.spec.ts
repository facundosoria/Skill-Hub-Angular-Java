import {
  edgeClass,
  edgeStrokeWidth,
  geom,
  NODE_COUNT_FONT_SIZE,
  NODE_HEIGHT,
  NODE_NAME_FONT_SIZE,
  NODE_WIDTH,
  nodeTextFits,
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
    expect(result.d).toBe('M443.0,290.0 Q401.5,315.5 359.1,353.0');
    expect(result.lx).toBeCloseTo(401.302495399392, 10);
    expect(result.ly).toBeCloseTo(318.48182930437986, 10);
  });

  it('matches the wider reverse curve when both directions exist', () => {
    const result = geom(nodes, 'cur', 'acc', true);
    expect(result.d).toBe('M424.1,290.0 Q393.2,304.2 349.7,353.0');
    expect(result.lx).toBeCloseTo(390.0596714092651, 10);
    expect(result.ly).toBeCloseTo(312.8563903305117, 10);
  });

  it('keeps horizontal paths and grouping compatible with the original', () => {
    expect(geom(nodes, 'usr', 'not', false).d).toBe('M403.0,116.5 Q530.0,122.0 653.0,116.7');
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

  it('keeps the seeded node rectangles separated and labels inside their width', () => {
    const seededNodes: Record<string, { x: number; y: number }> = {
      ux: { x: 95, y: 48 }, usr: { x: 300, y: 112 }, not: { x: 760, y: 112 }, cur: { x: 500, y: 255 },
      acc: { x: 315, y: 392 }, llm: { x: 685, y: 392 }, road: { x: 95, y: 392 }, teo: { x: 900, y: 290 },
      sand: { x: 900, y: 520 }, bko: { x: 500, y: 535 }, mkt: { x: 170, y: 650 }, mot: { x: 500, y: 705 },
      prac: { x: 810, y: 665 },
    };
    const names = ['UX/UI', 'Usuarios', 'Notificaciones', 'Cursos', 'Accounting', 'LLM', 'Roadmap', 'Desafíos teóricos', 'Sandbox', 'Backoffice', 'Market', 'Motor de desafíos', 'Desafíos prácticos'];
    const ids = Object.keys(seededNodes);
    for (let i = 0; i < ids.length; i++) {
      expect(nodeTextFits(names[i], NODE_NAME_FONT_SIZE)).toBe(true);
      for (let j = i + 1; j < ids.length; j++) {
        const a = seededNodes[ids[i]], b = seededNodes[ids[j]];
        const overlaps = Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
        expect(overlaps, `${ids[i]} / ${ids[j]}`).toBe(false);
      }
    }
    expect(nodeTextFits('↑999  ↓999', NODE_COUNT_FONT_SIZE)).toBe(true);
  });

  it('keeps the original relative time thresholds', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(relationForTimestamp('2025-12-31T23:59:30.000Z', now)).toBe('recién');
    expect(relationForTimestamp('2025-12-31T23:58:30.000Z', now)).toBe('hace 2 min');
    expect(relationForTimestamp('2025-12-30T00:00:00.000Z', now)).toBe('hace 2 d');
  });
});
