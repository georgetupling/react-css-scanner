import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import {
  analyzeSelectorQueries,
  buildParsedSelectorQueries,
  buildSelectorQueries,
  type SelectorSourceInput,
} from "../../pipeline/selector-analysis/index.js";
import type { SelectorAnalysisStageResult } from "./types.js";

export function runSelectorAnalysisStage(input: {
  selectorQueries: string[];
  selectorCssSources: SelectorSourceInput[];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorAnalysisStageResult {
  const parsedSelectorQueries = buildParsedSelectorQueries(buildSelectorQueries(input), {
    includeTraces: input.includeTraces,
  });

  return {
    selectorQueryResults: analyzeSelectorQueries({
      selectorQueries: parsedSelectorQueries,
      renderSubtrees: input.renderSubtrees,
      reachabilitySummary: input.reachabilitySummary,
      includeTraces: input.includeTraces,
    }),
  };
}
