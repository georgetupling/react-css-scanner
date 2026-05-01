import type { RenderStructureResult } from "../../pipeline/render-structure/index.js";
import {
  buildProjectSelectorProjection,
  buildSelectorReachability,
} from "../../pipeline/selector-reachability/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { FactGraphResult } from "../../pipeline/fact-graph/index.js";
import type { SelectorReachabilityStageResult } from "./types.js";

export function runSelectorReachabilityStage(input: {
  renderStructure: RenderStructureResult;
  factGraph: FactGraphResult;
  reachabilitySummary?: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorReachabilityStageResult {
  const selectorReachability = buildSelectorReachability(input.renderStructure);

  return {
    selectorReachability,
    projectSelectorProjection: buildProjectSelectorProjection({
      factGraph: input.factGraph,
      selectorReachability,
      renderModel: input.renderStructure.renderModel,
      reachabilitySummary: input.reachabilitySummary,
      includeTraces: input.includeTraces,
    }),
  };
}
