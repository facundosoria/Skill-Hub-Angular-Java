import {
  clampPan,
  clampScale,
  clampTransform,
  edgeClass,
  edgeStrokeWidth,
  geom,
  boxWithinViewBox,
  clampNode,
  clampNodes,
  MAP_IDENTITY,
  MAP_MAX_SCALE,
  MAP_MIN_SCALE,
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  mineTagBox,
  mineTagWidth,
  NODE_COUNT_FONT_SIZE,
  NODE_HEIGHT,
  NODE_NAME_FONT_SIZE,
  NODE_WIDTH,
  nodeBox,
  nodeTextFits,
  nodeClass,
  pairs,
  panBy,
  relationForTimestamp,
  touchedNodes,
  zoomAt,
  zoomedScale,
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
    const seededPositions: Record<string, { x: number; y: number }> = {
      ux: { x: 95, y: 48 }, usr: { x: 300, y: 112 }, not: { x: 760, y: 112 }, cur: { x: 500, y: 255 },
      acc: { x: 315, y: 392 }, llm: { x: 685, y: 392 }, road: { x: 95, y: 392 }, teo: { x: 900, y: 290 },
      sand: { x: 900, y: 520 }, bko: { x: 500, y: 535 }, mkt: { x: 170, y: 650 }, mot: { x: 500, y: 705 },
      prac: { x: 810, y: 665 },
    };
    const seededNodes = clampNodes(seededPositions);
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

  it('keeps every node and the your-group tag inside the viewBox margin', () => {
    const seededNodes = [
      { x: 95, y: 48 }, { x: 300, y: 112 }, { x: 760, y: 112 }, { x: 500, y: 255 },
      { x: 315, y: 392 }, { x: 685, y: 392 }, { x: 95, y: 392 }, { x: 900, y: 290 },
      { x: 900, y: 520 }, { x: 500, y: 535 }, { x: 170, y: 650 }, { x: 500, y: 705 },
      { x: 810, y: 665 },
    ];
    Object.values(clampNodes(Object.fromEntries(seededNodes.map((node, index) => [String(index), node])))).forEach((node) => {
      expect(boxWithinViewBox(nodeBox(node)), JSON.stringify(node)).toBe(true);
      expect(boxWithinViewBox(mineTagBox(node)), JSON.stringify(node)).toBe(true);
    });
  });

  it('sizes the group tag for Spanish and English labels and keeps both in bounds', () => {
    expect(mineTagWidth('your group')).toBeGreaterThan(mineTagWidth('tu grupo'));
    const english = clampNode({ x: 900, y: 112 }, 8, 'your group');
    expect(boxWithinViewBox(mineTagBox(english, 'your group'))).toBe(true);
    expect(mineTagBox(english, 'your group').width).toBe(mineTagWidth('your group'));
  });

  it('separates clamped seed nodes with a deterministic six-unit gap', () => {
    const source = { ux: { x: 95, y: 48 }, usr: { x: 300, y: 112 }, road: { x: 95, y: 392 }, teo: { x: 900, y: 290 }, sand: { x: 900, y: 520 }, mot: { x: 500, y: 705 } };
    const first = clampNodes(source), second = clampNodes(source);
    expect(second).toEqual(first);
    const ids = Object.keys(first);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = first[ids[i]], b = first[ids[j]];
      expect(Math.abs(a.x - b.x) >= NODE_WIDTH + 6 || Math.abs(a.y - b.y) >= NODE_HEIGHT + 6).toBe(true);
    }
  });

  it('clamps centers while preserving in-bounds positions and node metadata', () => {
    expect(clampNode({ x: 95, y: 48 })).toEqual({ x: 108, y: 57 });
    expect(clampNode({ x: 900, y: 705 })).toEqual({ x: 900, y: 705 });
    expect(clampNode({ x: 500, y: 300, n: 'UX/UI' } as { x: number; y: number; n: string })).toEqual({ x: 500, y: 300, n: 'UX/UI' });
  });

  it('keeps the original relative time thresholds', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(relationForTimestamp('2025-12-31T23:59:30.000Z', now)).toBe('recién');
    expect(relationForTimestamp('2025-12-31T23:58:30.000Z', now)).toBe('hace 2 min');
    expect(relationForTimestamp('2025-12-30T00:00:00.000Z', now)).toBe('hace 2 d');
  });
});

describe('dep-map zoom and pan math', () => {
  it('steps zoom by 1.25 and clamps to the 1x..3x range', () => {
    expect(zoomedScale(1, 1)).toBeCloseTo(1.25, 10);
    expect(zoomedScale(1.25, 1)).toBeCloseTo(1.5625, 10);
    expect(zoomedScale(MAP_MAX_SCALE, 1)).toBe(MAP_MAX_SCALE);
    expect(zoomedScale(1.1, -1)).toBe(MAP_MIN_SCALE);
    expect(clampScale(0.2)).toBe(MAP_MIN_SCALE);
    expect(clampScale(9)).toBe(MAP_MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(MAP_MIN_SCALE);
  });

  it('bounds pan so the scaled drawing always covers the viewport', () => {
    expect(clampPan(120, 1, MAP_VIEWBOX_WIDTH)).toBe(0);
    expect(clampPan(500, 2, MAP_VIEWBOX_WIDTH)).toBe(0);
    expect(clampPan(-500, 2, MAP_VIEWBOX_WIDTH)).toBe(-500);
    expect(clampPan(-2_000, 2, MAP_VIEWBOX_WIDTH)).toBe(-MAP_VIEWBOX_WIDTH);
    expect(clampPan(80, 2, MAP_VIEWBOX_HEIGHT)).toBe(0);
    expect(clampPan(-800, 2, MAP_VIEWBOX_HEIGHT)).toBe(-MAP_VIEWBOX_HEIGHT);
  });

  it('keeps the focus point fixed while zooming and re-clamps the result', () => {
    const focusX = 700, focusY = 500;
    const zoomed = zoomAt(MAP_IDENTITY, 2, focusX, focusY);
    expect(zoomed.scale).toBe(2);
    expect(focusX * zoomed.scale + zoomed.x).toBeCloseTo(focusX, 10);
    expect(focusY * zoomed.scale + zoomed.y).toBeCloseTo(focusY, 10);
    expect(zoomed.x).toBe(-700);
    expect(zoomed.y).toBe(-500);
  });

  it('clamps panBy moves and resets to the origin at 1x', () => {
    const panned = panBy({ scale: 2, x: -100, y: -100 }, -10_000, 5_000);
    expect(panned).toEqual({ scale: 2, x: -MAP_VIEWBOX_WIDTH, y: 0 });
    expect(clampTransform({ scale: 1, x: 40, y: -40 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
