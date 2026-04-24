import type { ProjectModel } from "../../../model/types.js";
import type { RenderGraph } from "../../pipeline/render-graph/types.js";

type EngineRenderContextReachability = {
  renderContextDefiniteLocalCss: Set<string>;
  renderContextPossibleLocalCss: Set<string>;
};

export function buildEngineRenderContextReachabilityBySourceFile(
  model: ProjectModel,
  renderGraph: RenderGraph,
): Map<string, EngineRenderContextReachability> {
  const renderersBySourcePath = buildRenderersBySourcePath(renderGraph);
  const reachabilityBySourceFile = new Map<string, EngineRenderContextReachability>();

  for (const sourceFile of model.graph.sourceFiles) {
    const directReachability = model.reachability.get(sourceFile.path);
    if (!directReachability) {
      continue;
    }

    const renderRoutes = collectRenderRoutes(sourceFile.path, renderersBySourcePath);
    const routeCssSets = renderRoutes.map((route) =>
      unionSets(
        route
          .map((sourcePath) => model.reachability.get(sourcePath)?.localCss)
          .filter((reachability): reachability is Set<string> => Boolean(reachability)),
      ),
    );

    const renderContextDefiniteLocalCss = new Set<string>();
    const renderContextPossibleLocalCss = new Set<string>();

    if (routeCssSets.length > 0) {
      const intersectedCss = intersectSets(routeCssSets);
      const unionCss = unionSets(routeCssSets);

      for (const cssPath of intersectedCss) {
        if (!directReachability.directLocalCss.has(cssPath)) {
          renderContextDefiniteLocalCss.add(cssPath);
        }
      }

      for (const cssPath of unionCss) {
        if (
          !directReachability.directLocalCss.has(cssPath) &&
          !renderContextDefiniteLocalCss.has(cssPath)
        ) {
          renderContextPossibleLocalCss.add(cssPath);
        }
      }
    }

    reachabilityBySourceFile.set(sourceFile.path, {
      renderContextDefiniteLocalCss: new Set(
        [...renderContextDefiniteLocalCss].sort((left, right) => left.localeCompare(right)),
      ),
      renderContextPossibleLocalCss: new Set(
        [...renderContextPossibleLocalCss].sort((left, right) => left.localeCompare(right)),
      ),
    });
  }

  return reachabilityBySourceFile;
}

function buildRenderersBySourcePath(renderGraph: RenderGraph): Map<string, Set<string>> {
  const renderersBySourcePath = new Map<string, Set<string>>();

  for (const edge of renderGraph.edges) {
    if (edge.resolution !== "resolved" || !edge.toFilePath) {
      continue;
    }

    const fromFilePath = normalizeProjectPath(edge.fromFilePath);
    const toFilePath = normalizeProjectPath(edge.toFilePath);
    if (!fromFilePath || !toFilePath || fromFilePath === toFilePath) {
      continue;
    }

    const renderers = renderersBySourcePath.get(toFilePath) ?? new Set<string>();
    renderers.add(fromFilePath);
    renderersBySourcePath.set(toFilePath, renderers);
  }

  return renderersBySourcePath;
}

function collectRenderRoutes(
  sourceFilePath: string,
  renderersBySourcePath: Map<string, Set<string>>,
  options: {
    maxDepth?: number;
    maxRoutes?: number;
  } = {},
): string[][] {
  const maxDepth = options.maxDepth ?? 25;
  const maxRoutes = options.maxRoutes ?? 100;
  const normalizedSourceFilePath = normalizeProjectPath(sourceFilePath) ?? sourceFilePath;
  const memo = new Map<string, string[][]>();

  return dedupeRoutes(
    collectRoutesToParent(normalizedSourceFilePath, 0, new Set<string>()),
    maxRoutes,
  );

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

function unionSets(sets: Array<Set<string>>): Set<string> {
  const union = new Set<string>();

  for (const currentSet of sets) {
    for (const item of currentSet) {
      union.add(item);
    }
  }

  return union;
}

function intersectSets(sets: Array<Set<string>>): Set<string> {
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

function normalizeProjectPath(filePath: string | undefined): string | undefined {
  return filePath?.replace(/\\/g, "/");
}
