import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import { buildProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderModel as RenderStructureModel } from "../../pipeline/render-structure/index.js";
import type { SelectorReachabilityResult } from "../../pipeline/selector-reachability/index.js";
import type { ProjectBindingResolution } from "../../pipeline/symbol-resolution/index.js";
import type {
  CssModuleLocalsConvention,
  ProjectAnalysisStylesheetInput,
} from "../../pipeline/project-analysis/index.js";
import type {
  FactGraphStageResult,
  ProjectAnalysisStageResult,
  SelectorAnalysisStageResult,
  SymbolicEvaluationStageResult,
} from "./types.js";

export function runProjectAnalysisStage(input: {
  moduleFacts: ModuleFacts;
  factGraph?: FactGraphStageResult;
  cssFiles: ExperimentalCssFileAnalysis[];
  stylesheets?: ProjectAnalysisStylesheetInput[];
  symbolResolution: ProjectBindingResolution;
  cssModuleLocalsConvention?: CssModuleLocalsConvention;
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: ReachabilitySummary;
  renderModel: RenderStructureModel;
  symbolicEvaluation?: SymbolicEvaluationStageResult;
  selectorReachability?: SelectorReachabilityResult;
  selectorQueryResults: SelectorAnalysisStageResult["selectorQueryResults"];
  includeTraces?: boolean;
}): ProjectAnalysisStageResult {
  return {
    projectAnalysis: buildProjectAnalysis(input),
  };
}
