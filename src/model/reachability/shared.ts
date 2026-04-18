export function collectReachableAncestors(
  sourceFilePath: string,
  ancestorsBySourcePath: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [...(ancestorsBySourcePath.get(sourceFilePath) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const ancestor of ancestorsBySourcePath.get(current) ?? []) {
      if (!visited.has(ancestor)) {
        queue.push(ancestor);
      }
    }
  }

  return visited;
}

export function collectRenderRoutes(
  sourceFilePath: string,
  renderersBySourcePath: Map<string, Set<string>>,
  options: {
    maxDepth?: number;
    maxRoutes?: number;
  } = {},
): string[][] {
  const maxDepth = options.maxDepth ?? 25;
  const maxRoutes = options.maxRoutes ?? 100;
  const memo = new Map<string, string[][]>();

  return dedupeRoutes(collectRoutesToParent(sourceFilePath, 0, new Set<string>()), maxRoutes);

  function collectRoutesToParent(
    currentPath: string,
    depth: number,
    activePath: Set<string>,
  ): string[][] {
    if (depth >= maxDepth || activePath.has(currentPath)) {
      return [];
    }

    const cached = memo.get(currentPath);
    if (cached) {
      return cached;
    }

    const directParents = [...(renderersBySourcePath.get(currentPath) ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    if (directParents.length === 0) {
      memo.set(currentPath, []);
      return [];
    }

    const nextActivePath = new Set(activePath);
    nextActivePath.add(currentPath);

    const routes: string[][] = [];
    for (const parentPath of directParents) {
      const parentRoutes = collectRoutesToParent(parentPath, depth + 1, nextActivePath);
      if (parentRoutes.length === 0) {
        routes.push([parentPath]);
      } else {
        for (const parentRoute of parentRoutes) {
          routes.push([...parentRoute, parentPath]);
        }
      }

      if (routes.length >= maxRoutes) {
        break;
      }
    }

    const dedupedRoutes = dedupeRoutes(routes, maxRoutes);
    memo.set(currentPath, dedupedRoutes);
    return dedupedRoutes;
  }
}

export function unionSets(sets: Array<Set<string>>): Set<string> {
  const union = new Set<string>();

  for (const currentSet of sets) {
    for (const item of currentSet) {
      union.add(item);
    }
  }

  return union;
}

export function intersectSets(sets: Array<Set<string>>): Set<string> {
  if (sets.length === 0) {
    return new Set<string>();
  }

  const intersection = new Set(sets[0]);
  for (const currentSet of sets.slice(1)) {
    for (const item of intersection) {
      if (!currentSet.has(item)) {
        intersection.delete(item);
      }
    }
  }

  return intersection;
}

function dedupeRoutes(routes: string[][], maxRoutes: number): string[][] {
  const seen = new Set<string>();
  const deduped: string[][] = [];

  for (const route of routes) {
    const key = route.join(" -> ");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(route);

    if (deduped.length >= maxRoutes) {
      break;
    }
  }

  return deduped;
}
