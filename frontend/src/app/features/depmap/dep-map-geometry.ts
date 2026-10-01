export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 52;

export interface GeometryNode {
  x: number;
  y: number;
}

export interface GeometryEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  state: string;
  text: string;
}

export interface GeometryResult {
  d: string;
  lx: number;
  ly: number;
  control: [number, number];
  start: [number, number];
  end: [number, number];
}

/** Literal port of the original map's rectangle clipping function. */
export function clip(node: GeometryNode, targetX: number, targetY: number, gap: number): [number, number] {
  const dx = targetX - node.x;
  const dy = targetY - node.y;
  const k = Math.min(
    (NODE_WIDTH / 2 + gap) / Math.abs(dx || 1e-6),
    (NODE_HEIGHT / 2 + gap) / Math.abs(dy || 1e-6),
  );
  return [node.x + dx * k, node.y + dy * k];
}

/** Literal port of the original map's quadratic curve geometry. */
export function geom(
  nodes: Record<string, GeometryNode>,
  from: string,
  to: string,
  reverse: boolean,
): GeometryResult {
  const a = nodes[from];
  const b = nodes[to];
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const offset = reverse ? 24 : 10;
  const cx = mx + (-dy / len) * offset;
  const cy = my + (dx / len) * offset;
  const start = clip(a, cx, cy, 3);
  const end = clip(b, cx, cy, 7);
  return {
    d: `M${start[0].toFixed(1)},${start[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}`,
    lx: 0.25 * start[0] + 0.5 * cx + 0.25 * end[0],
    ly: 0.25 * start[1] + 0.5 * cy + 0.25 * end[1],
    control: [cx, cy],
    start,
    end,
  };
}

/** Groups edges using the exact `from>to` key used by the original app. */
export function pairs<T extends Pick<GeometryEdge, 'from' | 'to'>>(list: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  list.forEach((edge) => {
    const key = `${edge.from}>${edge.to}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(edge);
  });
  return grouped;
}

export function relationForTimestamp(timestamp: string | null | undefined, now = Date.now()): string {
  if (!timestamp) return '';
  const seconds = (now - new Date(timestamp).getTime()) / 1000;
  if (seconds < 45) return 'recién';
  if (seconds < 90) return 'hace 1 min';
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 7200) return 'hace 1 h';
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} d`;
}

export const rel = relationForTimestamp;

export type EdgeClass = 'base' | 'out' | 'in' | 'sel' | 'dim';

export function touchedNodes(edges: GeometryEdge[], node: string | null): Set<string> {
  const touched = new Set<string>();
  if (node) {
    edges.forEach((edge) => {
      if (edge.from === node) touched.add(`o${edge.to}`);
      if (edge.to === node) touched.add(`i${edge.from}`);
    });
  }
  return touched;
}

export function edgeClass(from: string, to: string, selectedNode: string | null, selectedPair: [string, string] | null): EdgeClass {
  if (selectedPair) return selectedPair[0] === from && selectedPair[1] === to ? 'sel' : 'dim';
  if (selectedNode) return from === selectedNode ? 'out' : to === selectedNode ? 'in' : 'dim';
  return 'base';
}

export function nodeClass(
  id: string,
  selectedNode: string | null,
  selectedPair: [string, string] | null,
  touched: Set<string>,
  transversal = false,
): string {
  let classes = '';
  if (id === selectedNode && !selectedPair) classes = 'sel';
  else if (selectedPair) classes = id === selectedPair[0] || id === selectedPair[1] ? '' : 'dim';
  else if (selectedNode && id !== selectedNode) {
    classes = touched.has(`o${id}`) ? 'out' : touched.has(`i${id}`) ? 'in' : 'dim';
  }
  return `${classes}${transversal ? ' transv' : ''}`.trim();
}

export function edgeStrokeWidth(count: number): string {
  return (1.2 + Math.min(count, 6) * 0.45).toFixed(2);
}
