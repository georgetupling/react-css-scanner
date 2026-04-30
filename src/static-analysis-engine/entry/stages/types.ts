import ts from "typescript";

import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { UnsupportedClassReferenceDiagnostic } from "../../pipeline/render-model/class-reference-diagnostics/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { LanguageFrontendsResult } from "../../pipeline/language-frontends/index.js";
import type { FactGraphResult } from "../../pipeline/fact-graph/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import type { SelectorQueryResult } from "../../pipeline/selector-analysis/index.js";
import type { ProjectBindingResolution } from "../../pipeline/symbol-resolution/index.js";
import type {
  LegacyRenderModelClassExpressionSummaryRecord,
  SymbolicEvaluationResult,
} from "../../pipeline/symbolic-evaluation/index.js";

export type LanguageFrontendsStageResult = LanguageFrontendsResult;

export type FactGraphStageResult = FactGraphResult;

export type SymbolicEvaluationStageResult = SymbolicEvaluationResult;

export type ParsedProjectFile = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
};

export type SymbolResolutionStageResult = ProjectBindingResolution;

export type ModuleFactsStageResult = {
  moduleFacts: ModuleFacts;
};

export type CssAnalysisStageResult = {
  cssFiles: ExperimentalCssFileAnalysis[];
};

export type ExternalCssStageResult = {
  externalCssSummary: ExternalCssSummary;
};

export type ReachabilityStageResult = {
  reachabilitySummary: ReachabilitySummary;
};

export type SelectorAnalysisStageResult = {
  selectorQueryResults: SelectorQueryResult[];
};

export type RenderModelStageResult = {
  renderSubtrees: RenderSubtree[];
  renderGraph: RenderGraph;
  unsupportedClassReferences: UnsupportedClassReferenceDiagnostic[];
  legacyClassExpressionSummaries: LegacyRenderModelClassExpressionSummaryRecord[];
};

export type ProjectAnalysisStageResult = {
  projectAnalysis: ProjectAnalysis;
};
