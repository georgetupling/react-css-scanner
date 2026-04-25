import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import { buildReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { ReachabilityStageResult } from "./types.js";

export function runReachabilityStage(input: {
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  selectorCssSources: SelectorSourceInput[];
  externalCssSummary: ExternalCssSummary;
}): ReachabilityStageResult {
  return {
    reachabilitySummary: buildReachabilitySummary({
      moduleGraph: input.moduleGraph,
      renderGraph: input.renderGraph,
      renderSubtrees: input.renderSubtrees,
      cssSources: input.selectorCssSources,
      externalCssSummary: input.externalCssSummary,
    }),
  };
}
