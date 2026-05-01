import type { FactGraph } from "../types.js";

export type ReachabilityStylesheetInput = {
  filePath?: string;
  cssText?: string;
};

export function graphToStylesheetFilePaths(graph: FactGraph): string[] {
  return graph.nodes.stylesheets
    .map((stylesheet) => stylesheet.filePath)
    .filter((filePath): filePath is string => Boolean(filePath))
    .sort((left, right) => left.localeCompare(right));
}

export function graphToReachabilityStylesheets(graph: FactGraph): ReachabilityStylesheetInput[] {
  return graph.nodes.stylesheets.map((stylesheet) => ({
    filePath: stylesheet.filePath,
  }));
}
