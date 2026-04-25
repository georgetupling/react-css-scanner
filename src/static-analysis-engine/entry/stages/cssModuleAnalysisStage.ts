import { analyzeCssModules } from "../../pipeline/css-modules/index.js";
import type { CssModuleAnalysisOptions } from "../../pipeline/css-modules/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ParsedProjectFile } from "./types.js";
import type { CssModuleAnalysisStageResult } from "./types.js";

export function runCssModuleAnalysisStage(input: {
  parsedFiles: ParsedProjectFile[];
  moduleGraph: ModuleGraph;
  cssFiles: ExperimentalCssFileAnalysis[];
  options?: CssModuleAnalysisOptions;
}): CssModuleAnalysisStageResult {
  return {
    cssModules: analyzeCssModules(input),
  };
}
