import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { CssFrontendFacts } from "../../pipeline/language-frontends/index.js";
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
  css?: CssFrontendFacts;
  selectorCssSources?: SelectorSourceInput[];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorAnalysisStageResult {
  const parsedSelectorQueries = buildParsedSelectorQueries(
    buildSelectorQueries({
      selectorQueries: input.selectorQueries,
      selectorEntries: input.css?.files.flatMap((file) => file.selectorEntries),
      selectorCssSources: input.selectorCssSources,
    }),
    {
      includeTraces: input.includeTraces,
    },
  );

  return {
    selectorQueryResults: analyzeSelectorQueries({
      selectorQueries: parsedSelectorQueries,
      renderSubtrees: input.renderSubtrees,
      reachabilitySummary: input.reachabilitySummary,
      includeTraces: input.includeTraces,
    }),
  };
}
