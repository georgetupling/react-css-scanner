import type { ModuleGraph } from "../module-graph/types.js";
import { normalizeProjectPath } from "./pathUtils.js";

export function collectAnalyzedSourceFilePaths(moduleGraph: ModuleGraph): string[] {
  return [...moduleGraph.modulesById.values()]
    .filter((moduleNode) => moduleNode.kind === "source")
    .map((moduleNode) => normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath)
    .sort((left, right) => left.localeCompare(right));
}
