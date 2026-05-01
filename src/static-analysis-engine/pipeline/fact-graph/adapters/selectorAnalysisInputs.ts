import type { ExtractedSelectorQuery } from "../../../libraries/selector-parsing/queryTypes.js";
import type { FactGraph } from "../types.js";

export function graphToSelectorEntries(graph: FactGraph): ExtractedSelectorQuery[] {
  return graph.nodes.selectorBranches.map((branch) => branch.sourceQuery);
}
