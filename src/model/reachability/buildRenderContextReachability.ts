import type { ReachabilityInfo, SourceFileNode } from "../types.js";
import { collectRenderRoutes, intersectSets, unionSets } from "./shared.js";

export function buildRenderContextReachability(input: {
  sourceFiles: SourceFileNode[];
  importReachability: Map<string, ReachabilityInfo>;
  renderersBySourcePath: Map<string, Set<string>>;
}): Map<string, ReachabilityInfo> {
  const { sourceFiles, importReachability, renderersBySourcePath } = input;
  const reachabilityBySourceFile = new Map<string, ReachabilityInfo>();

  for (const sourceFile of sourceFiles) {
    const directReachability = importReachability.get(sourceFile.path);
    if (!directReachability) {
      continue;
    }

    const renderRoutes = collectRenderRoutes(sourceFile.path, renderersBySourcePath);
    const routeCssSets = renderRoutes.map((route) =>
      unionSets(
        route
          .map((sourcePath) => importReachability.get(sourcePath)?.localCss)
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
      ...directReachability,
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
