import type { RenderStructureResult } from "../../pipeline/render-structure/index.js";
import { buildSelectorReachability } from "../../pipeline/selector-reachability/index.js";
import type { SelectorReachabilityStageResult } from "./types.js";

export function runSelectorReachabilityStage(input: {
  renderStructure: RenderStructureResult;
}): SelectorReachabilityStageResult {
  const selectorReachability = buildSelectorReachability(input.renderStructure);

  return {
    selectorReachability,
  };
}
