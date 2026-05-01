import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import { graphToSelectorEntries, type FactGraphResult } from "../../pipeline/fact-graph/index.js";
import type { CssFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { RenderModel } from "../../pipeline/render-structure/index.js";
import {
  analyzeSelectorQueries,
  buildParsedSelectorQueries,
  buildSelectorQueries,
  type SelectorSourceInput,
} from "../../pipeline/selector-analysis/index.js";
import type { SelectorAnalysisStageResult } from "./types.js";

export function runSelectorAnalysisStage(input: {
  selectorQueries: string[];
  factGraph?: FactGraphResult;
  css?: CssFrontendFacts;
  selectorCssSources?: SelectorSourceInput[];
  renderModel: RenderModel;
  reachabilitySummary: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorAnalysisStageResult {
  const parsedSelectorQueries = buildParsedSelectorQueries(
    buildSelectorQueries({
      selectorQueries: input.selectorQueries,
      selectorEntries: input.factGraph
        ? graphToSelectorEntries(input.factGraph.graph)
        : input.css?.files.flatMap((file) => file.selectorEntries),
      selectorCssSources: input.selectorCssSources,
    }),
    {
      includeTraces: input.includeTraces,
    },
  );

  return {
    selectorQueryResults: analyzeSelectorQueries({
      selectorQueries: parsedSelectorQueries,
      renderModel: input.renderModel,
      reachabilitySummary: input.reachabilitySummary,
      includeTraces: input.includeTraces,
    }),
  };
}
