import { analyzeCssSources } from "../../pipeline/css-analysis/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { CssAnalysisStageResult } from "./types.js";

export function runCssAnalysisStage(input: {
  selectorCssSources: SelectorSourceInput[];
}): CssAnalysisStageResult {
  return {
    cssFiles: analyzeCssSources(input.selectorCssSources),
  };
}
