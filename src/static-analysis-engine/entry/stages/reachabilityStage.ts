import { buildReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import {
  graphToReachabilityStylesheets,
  type FactGraphResult,
} from "../../pipeline/fact-graph/index.js";
import type { CssFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { RenderModel } from "../../pipeline/render-structure/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { ProjectResourceEdge } from "../../pipeline/workspace-discovery/index.js";
import type { ReachabilityStageResult } from "./types.js";

export function runReachabilityStage(input: {
  moduleFacts: ModuleFacts;
  factGraph?: FactGraphResult;
  renderModel: RenderModel;
  css?: CssFrontendFacts;
  selectorCssSources: SelectorSourceInput[];
  resourceEdges?: ProjectResourceEdge[];
  externalCssSummary: ExternalCssSummary;
  includeTraces?: boolean;
}): ReachabilityStageResult {
  return {
    reachabilitySummary: buildReachabilitySummary({
      moduleFacts: input.moduleFacts,
      renderModel: input.renderModel,
      stylesheets: input.factGraph
        ? graphToReachabilityStylesheets(input.factGraph.graph)
        : (input.css?.files.map((file) => ({
            filePath: file.filePath,
            cssText: file.cssText,
          })) ?? input.selectorCssSources),
      resourceEdges: input.resourceEdges,
      externalCssSummary: input.externalCssSummary,
      includeTraces: input.includeTraces ?? true,
    }),
  };
}
