import { analyzeCssRuleFiles, analyzeCssSources } from "../../pipeline/css-analysis/index.js";
import type { CssFrontendFacts } from "../../pipeline/language-frontends/index.js";
import type { SelectorSourceInput } from "../../pipeline/selector-analysis/index.js";
import type { CssAnalysisStageResult } from "./types.js";

export function runCssAnalysisStage(input: {
  css?: CssFrontendFacts;
  selectorCssSources?: SelectorSourceInput[];
}): CssAnalysisStageResult {
  if (!input.css) {
    return {
      cssFiles: analyzeCssSources(input.selectorCssSources ?? []),
    };
  }

  return {
    cssFiles: analyzeCssRuleFiles(
      input.css.files.map((file) => ({
        filePath: file.filePath,
        rules: file.rules,
      })),
    ),
  };
}
