export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 64;
export const MAP_VIEWBOX_WIDTH = 1000;
export const MAP_VIEWBOX_HEIGHT = 745;
export const MAP_VIEWBOX_MARGIN = 8;
export const NODE_TEXT_X = 14;
export const NODE_TEXT_RIGHT_PADDING = 14;
export const NODE_NAME_FONT_SIZE = 16;
export const NODE_COUNT_FONT_SIZE = 13;

/** Conservative SVG text-width estimate used by the geometry tests. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

export function nodeTextFits(text: string, fontSize: number): boolean {
  return estimateTextWidth(text, fontSize) <= NODE_WIDTH - NODE_TEXT_X - NODE_TEXT_RIGHT_PADDING;
}

export interface GeometryNode {
  x: number;
  y: number;
}

export interface GeometryBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MINE_TAG_X = 136;
const MINE_TAG_Y = -9;
const MINE_TAG_WIDTH = 56;
const MINE_TAG_HEIGHT = 17;

export function nodeBox(node: GeometryNode): GeometryBox {
  return { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** Clamp a node center so its full rectangle and optional group tag fit the map. */
export function clampNode<T extends GeometryNode>(node: T, margin = MAP_VIEWBOX_MARGIN): T {
  const minX = margin + NODE_WIDTH / 2;
  const maxX = MAP_VIEWBOX_WIDTH - margin - NODE_WIDTH / 2;
  const minY = margin + NODE_HEIGHT / 2 + MINE_TAG_HEIGHT;
  const maxY = MAP_VIEWBOX_HEIGHT - margin - NODE_HEIGHT / 2;
  return {
    ...node,
    x: Math.min(maxX, Math.max(minX, node.x)),
    y: Math.min(maxY, Math.max(minY, node.y)),
  } as T;
}

/** Clamp all rendered centers and deterministically separate boxes without mutating saved data. */
export function clampNodes<T extends GeometryNode>(nodes: Record<string, T>, margin = MAP_VIEWBOX_MARGIN, gap = 6): Record<string, T> {
  const result = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, clampNode(node, margin)])) as Record<string, T>;
  const ids = Object.keys(result);
  const minX = margin + NODE_WIDTH / 2, maxX = MAP_VIEWBOX_WIDTH - margin - NODE_WIDTH / 2;
  const minY = margin + NODE_HEIGHT / 2 + MINE_TAG_HEIGHT, maxY = MAP_VIEWBOX_HEIGHT - margin - NODE_HEIGHT / 2;
  for (let iteration = 0; iteration < 20; iteration++) {
    let changed = false;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = result[ids[i]], b = result[ids[j]];
      const dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = NODE_WIDTH + gap - Math.abs(dx), overlapY = NODE_HEIGHT + gap - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const axis = overlapX <= overlapY ? 'x' : 'y';
      const amount = axis === 'x' ? overlapX : overlapY;
      const aSign = (axis === 'x' ? dx : dy) >= 0 ? -1 : 1;
      const aValue = axis === 'x' ? a.x : a.y;
      const bValue = axis === 'x' ? b.x : b.y;
      const aMin = axis === 'x' ? minX : minY, aMax = axis === 'x' ? maxX : maxY;
      const aRoom = aSign < 0 ? aValue - aMin : aMax - aValue;
      const bSign = -aSign, bRoom = bSign < 0 ? bValue - aMin : aMax - bValue;
      const aMove = Math.min(amount / 2, Math.max(0, aRoom));
      const bMove = Math.min(amount - aMove, Math.max(0, bRoom));
      const extra = amount - aMove - bMove;
      const finalAMove = aMove + Math.min(extra, Math.max(0, aRoom - aMove));
      const finalBMove = bMove + Math.min(extra - (finalAMove - aMove), Math.max(0, bRoom - bMove));
      if (axis === 'x') { a.x += aSign * finalAMove; b.x += bSign * finalBMove; }
      else { a.y += aSign * finalAMove; b.y += bSign * finalBMove; }
      changed = true;
    }
    if (!changed) break;
  }
  return result;
}

/** The "your group" tag is positioned relative to the node's top-left corner. */
export function mineTagBox(node: GeometryNode): GeometryBox {
  const box = nodeBox(node);
  return { x: box.x + MINE_TAG_X, y: box.y + MINE_TAG_Y, width: MINE_TAG_WIDTH, height: MINE_TAG_HEIGHT };
}

export function boxWithinViewBox(box: GeometryBox, margin = MAP_VIEWBOX_MARGIN): boolean {
  return box.x >= margin && box.y >= margin
    && box.x + box.width <= MAP_VIEWBOX_WIDTH - margin
    && box.y + box.height <= MAP_VIEWBOX_HEIGHT - margin;
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

export const MAP_MIN_SCALE = 1;
export const MAP_MAX_SCALE = 3;
export const MAP_ZOOM_STEP = 1.25;
export const MAP_PAN_THRESHOLD = 4;

export interface MapTransform {
  scale: number;
  x: number;
  y: number;
}

export const MAP_IDENTITY: MapTransform = { scale: MAP_MIN_SCALE, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MAP_MIN_SCALE;
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, scale));
}

/** One zoom step in `direction` (+1 in, -1 out), clamped to the allowed range. */
export function zoomedScale(scale: number, direction: 1 | -1): number {
  return clampScale(direction > 0 ? scale * MAP_ZOOM_STEP : scale / MAP_ZOOM_STEP);
}

/**
 * Keeps the scaled drawing covering the viewport: after `translate(t) scale(s)`
 * the content spans `[t, t + size * s]`, so `t` must stay in `[size*(1-s), 0]`.
 */
export function clampPan(value: number, scale: number, size: number): number {
  if (scale <= MAP_MIN_SCALE) return 0;
  return Math.min(0, Math.max(size * (1 - scale), value));
}

export function clampTransform(transform: MapTransform): MapTransform {
  const scale = clampScale(transform.scale);
  return {
    scale,
    x: clampPan(transform.x, scale, MAP_VIEWBOX_WIDTH),
    y: clampPan(transform.y, scale, MAP_VIEWBOX_HEIGHT),
  };
}

/** Zooms to `nextScale` keeping the map point (`focusX`, `focusY`) fixed on screen. */
export function zoomAt(transform: MapTransform, nextScale: number, focusX: number, focusY: number): MapTransform {
  const scale = clampScale(nextScale);
  return clampTransform({
    scale,
    x: transform.x + focusX * (transform.scale - scale),
    y: transform.y + focusY * (transform.scale - scale),
  });
}

export function panBy(transform: MapTransform, dx: number, dy: number): MapTransform {
  return clampTransform({ scale: transform.scale, x: transform.x + dx, y: transform.y + dy });
}
