import { buildReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { CssFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { ProjectResourceEdge } from "../../pipeline/workspace-discovery/index.js";
import type { ReachabilityStageResult } from "./types.js";

export function runReachabilityStage(input: {
  moduleFacts: ModuleFacts;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  css?: CssFrontendFacts;
  selectorCssSources: SelectorSourceInput[];
  resourceEdges?: ProjectResourceEdge[];
  externalCssSummary: ExternalCssSummary;
  includeTraces?: boolean;
}): ReachabilityStageResult {
  return {
    reachabilitySummary: buildReachabilitySummary({
      moduleFacts: input.moduleFacts,
      renderGraph: input.renderGraph,
      renderSubtrees: input.renderSubtrees,
      stylesheets:
        input.css?.files.map((file) => ({
          filePath: file.filePath,
          cssText: file.cssText,
        })) ?? input.selectorCssSources,
      resourceEdges: input.resourceEdges,
      externalCssSummary: input.externalCssSummary,
      includeTraces: input.includeTraces ?? true,
    }),
  };
}
