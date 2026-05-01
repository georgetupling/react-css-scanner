import ts from "typescript";

import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { AnalysisEvidence } from "../../pipeline/analysis-evidence/index.js";
import type { ProjectAnalysisIndexes } from "../../pipeline/project-analysis/index.js";
import type { ModuleFacts } from "../../pipeline/module-facts/index.js";
import type { LanguageFrontendsResult } from "../../pipeline/language-frontends/index.js";
import type { FactGraphResult } from "../../pipeline/fact-graph/index.js";
import type { SelectorQueryResult } from "../../pipeline/selector-analysis/index.js";
import type { SelectorReachabilityResult } from "../../pipeline/selector-reachability/index.js";
import type { ProjectBindingResolution } from "../../pipeline/symbol-resolution/index.js";
import type { SymbolicEvaluationResult } from "../../pipeline/symbolic-evaluation/index.js";
import type { RenderStructureResult } from "../../pipeline/render-structure/index.js";

export type LanguageFrontendsStageResult = LanguageFrontendsResult;

export type FactGraphStageResult = FactGraphResult;

export type SymbolicEvaluationStageResult = SymbolicEvaluationResult;

export type RenderStructureStageResult = RenderStructureResult;

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

export type SelectorReachabilityStageResult = {
  selectorReachability: SelectorReachabilityResult;
};

export type SelectorAnalysisStageResult = {
  selectorQueryResults: SelectorQueryResult[];
};

export type AnalysisEvidenceStageResult = {
  analysisEvidence: AnalysisEvidence;
  projectAnalysisIndexes: ProjectAnalysisIndexes;
};

export type ProjectAnalysisStageResult = {
  projectAnalysis: ProjectAnalysis;
};
