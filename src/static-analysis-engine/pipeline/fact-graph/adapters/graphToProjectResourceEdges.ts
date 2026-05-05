import type { FactGraph } from "../types.js";
import { compareProjectResourceEdges } from "../../workspace-discovery/utils/sorting.js";
import type { ProjectResourceEdge } from "../../workspace-discovery/index.js";

export function graphToProjectResourceEdges(graph: FactGraph): ProjectResourceEdge[] {
  const resourceEdges: ProjectResourceEdge[] = [];

  for (const importEdge of graph.edges.imports) {
    if (importEdge.importerKind === "source") {
      resourceEdges.push({
        kind: "source-import",
        importerFilePath: importEdge.importerFilePath,
        specifier: importEdge.specifier,
        importKind: importEdge.importKind,
        importLoading: importEdge.importLoading,
        resolutionStatus: importEdge.resolutionStatus,
        ...(importEdge.resolvedFilePath ? { resolvedFilePath: importEdge.resolvedFilePath } : {}),
      });
      continue;
    }

    if (importEdge.importKind === "css" && importEdge.resolutionStatus === "resolved") {
      resourceEdges.push({
        kind: "stylesheet-import",
        importerFilePath: importEdge.importerFilePath,
        specifier: importEdge.specifier,
        resolvedFilePath: importEdge.resolvedFilePath ?? importEdge.to,
      });
    }
  }

  return resourceEdges.sort(compareProjectResourceEdges);
}
