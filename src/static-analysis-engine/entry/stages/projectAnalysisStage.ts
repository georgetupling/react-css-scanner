import type { UnsupportedClassReferenceDiagnostic } from "../../pipeline/render-model/class-reference-diagnostics/index.js";
import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { CssModuleAnalysis } from "../../pipeline/css-modules/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import { buildProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import type { ProjectAnalysisStageResult, SelectorAnalysisStageResult } from "./types.js";

export function runProjectAnalysisStage(input: {
  moduleGraph: ModuleGraph;
  cssFiles: ExperimentalCssFileAnalysis[];
  cssModules: CssModuleAnalysis;
  externalCssSummary: ExternalCssSummary;
  reachabilitySummary: ReachabilitySummary;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
  selectorQueryResults: SelectorAnalysisStageResult["selectorQueryResults"];
}): ProjectAnalysisStageResult {
  return {
    projectAnalysis: buildProjectAnalysis(input),
  };
}
