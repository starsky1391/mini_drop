import type { FlameGraphViewState, FlameNode } from '../shared/types';

export interface FlameGraphRow {
  node: FlameNode;
  depth: number;
  x: number;
  width: number;
  path: string;
}

export interface FlameGraphMatch {
  path: string;
  node: FlameNode;
  depth: number;
}

const defaultCanvasWidth = 1000;

export function maxFlameDepth(node: FlameNode, depth = 0): number {
  if (!node.children?.length) {
    return depth;
  }

  const childDepth = isHiddenRoot(node) ? depth : depth + 1;
  return Math.max(depth, ...node.children.map((child) => maxFlameDepth(child, childDepth)));
}

export function buildFlameGraphRows(
  root: FlameNode,
  viewState: Pick<FlameGraphViewState, 'focusPath'>,
  canvasWidth = defaultCanvasWidth,
): FlameGraphRow[] {
  const focusNode = resolveFocusedFlameNode(root, viewState.focusPath);
  const rows: FlameGraphRow[] = [];
  const walk = (node: FlameNode, depth: number, x: number, width: number, path: string) => {
    if (!isHiddenRoot(node)) {
      rows.push({ node, depth, x, width, path });
    }

    let cursor = x;
    const childDepth = isHiddenRoot(node) ? depth : depth + 1;
    for (const child of node.children ?? []) {
      const safeWidth = node.value > 0 ? width * (child.value / node.value) : 0;
      const childPath = appendFlamePath(path, child);
      walk(child, childDepth, cursor, safeWidth, childPath);
      cursor += safeWidth;
    }
  };

  walk(focusNode, 0, 0, canvasWidth, buildFlamePath(focusNode));
  return rows;
}

export function resolveFocusedFlameNode(root: FlameNode, focusPath: string | null) {
  if (!focusPath) {
    return root;
  }

  return findFlameNodeByPath(root, focusPath)?.node ?? root;
}

export function findFlameNodeByPath(root: FlameNode, targetPath: string) {
  const walk = (node: FlameNode, depth: number, path: string): { node: FlameNode; depth: number } | null => {
    if (path === targetPath) {
      return { node, depth };
    }

    const childDepth = isHiddenRoot(node) ? depth : depth + 1;
    for (const child of node.children ?? []) {
      const match = walk(child, childDepth, appendFlamePath(path, child));
      if (match) {
        return match;
      }
    }
    return null;
  };

  return walk(root, 0, buildFlamePath(root));
}

export function searchFlameGraph(
  root: FlameNode,
  term: string,
  focusPath: string | null,
): FlameGraphMatch[] {
  const normalized = normalizeSearchTerm(term);
  if (!normalized) {
    return [];
  }

  const focusNode = resolveFocusedFlameNode(root, focusPath);
  const matches: FlameGraphMatch[] = [];
  const walk = (node: FlameNode, depth: number, path: string) => {
    if (!isHiddenRoot(node) && flameNodeSearchText(node).includes(normalized)) {
      matches.push({ path, node, depth });
    }

    const childDepth = isHiddenRoot(node) ? depth : depth + 1;
    for (const child of node.children ?? []) {
      walk(child, childDepth, appendFlamePath(path, child));
    }
  };

  walk(focusNode, 0, buildFlamePath(focusNode));
  return matches;
}

export function flameNodeTooltip(node: FlameNode, totalValue: number) {
  const share = totalValue > 0 ? ((node.value / totalValue) * 100).toFixed(1) : '0.0';
  const location = node.locationSummary ? ` · ${node.locationSummary}` : node.module ? ` · ${node.module}` : '';
  return `${node.name}${location} · ${share}% · ${node.value}`;
}

export function truncateFlameLabel(label: string, width: number) {
  if (width <= 54) {
    return '';
  }

  const maxChars = Math.max(4, Math.floor((width - 18) / 7.2));
  if (label.length <= maxChars) {
    return label;
  }
  return `${label.slice(0, Math.max(1, maxChars - 3))}...`;
}

export function flameNodeSearchText(node: FlameNode) {
  return [node.name, node.module, node.locationSummary, node.sourceHint]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

export function buildFlamePath(node: FlameNode) {
  return buildFlameSegment(node);
}

function appendFlamePath(basePath: string, node: FlameNode) {
  return `${basePath}>${buildFlameSegment(node)}`;
}

function buildFlameSegment(node: FlameNode) {
  return encodeURIComponent(
    [node.name, node.module ?? '', node.locationSummary ?? '', node.sourceHint ?? ''].join('::'),
  );
}

function isHiddenRoot(node: FlameNode) {
  return node.hidden === true;
}

function normalizeSearchTerm(term: string) {
  return term.trim().toLowerCase();
}
