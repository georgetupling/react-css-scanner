import ts from "typescript";

import type { ExperimentalCssFileAnalysis } from "../../pipeline/css-analysis/index.js";
import type { CssModuleAnalysis } from "../../pipeline/css-modules/index.js";
import type { UnsupportedClassReferenceDiagnostic } from "../../pipeline/render-model/class-reference-diagnostics/index.js";
import type { ExternalCssSummary } from "../../pipeline/external-css/index.js";
import type { ModuleGraph } from "../../pipeline/module-graph/index.js";
import type { ReachabilitySummary } from "../../pipeline/reachability/index.js";
import type { ProjectAnalysis } from "../../pipeline/project-analysis/index.js";
import type { RenderGraph } from "../../pipeline/render-model/render-graph/index.js";
import type { RenderSubtree } from "../../pipeline/render-model/render-ir/index.js";
import type { SelectorQueryResult } from "../../pipeline/selector-analysis/index.js";
import type {
  EngineSymbol,
  ProjectBindingResolution,
} from "../../pipeline/symbol-resolution/index.js";
import type { EngineSymbolId } from "../../types/core.js";

export type ParseStageResult = {
  parsedFiles: ParsedProjectFile[];
};

export type ParsedProjectFile = {
  filePath: string;
  parsedSourceFile: ts.SourceFile;
};

export type ProjectSymbolCollection = {
  symbols: Map<EngineSymbolId, EngineSymbol>;
  symbolsByFilePath: Map<string, Map<EngineSymbolId, EngineSymbol>>;
};

export type SymbolResolutionStageResult = ProjectBindingResolution;

export type ModuleGraphStageResult = {
  moduleGraph: ModuleGraph;
};

export type CssAnalysisStageResult = {
  cssFiles: ExperimentalCssFileAnalysis[];
};

export type CssModuleAnalysisStageResult = {
  cssModules: CssModuleAnalysis;
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
};

export type ProjectAnalysisStageResult = {
  projectAnalysis: ProjectAnalysis;
};
