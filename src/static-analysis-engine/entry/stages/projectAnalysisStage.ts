import type { UnsupportedClassReferenceDiagnostic } from "../../pipeline/render-model/class-reference-diagnostics/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import { buildProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
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
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
  symbolicEvaluation?: SymbolicEvaluationStageResult;
  selectorQueryResults: SelectorAnalysisStageResult["selectorQueryResults"];
  includeTraces?: boolean;
}): ProjectAnalysisStageResult {
  return {
    projectAnalysis: buildProjectAnalysis(input),
  };
}
